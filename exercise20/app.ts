import fs from "fs/promises";
import path from "path";
import { OpenAIService } from "./OpenAIService";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

// Licznik iteracji wyłącznie do logów, nie ogranicza wykonywania pętli
let iterationCounter = 0;

/**
 * Reads the note.md and questions.json files and returns their contents.
 */
async function loadData() {
  const notePath = path.join(__dirname, "note.md");
  const questionsPath = path.join(__dirname, "questions.json");

  const [noteRaw, questionsRaw] = await Promise.all([
    fs.readFile(notePath, "utf-8"),
    fs.readFile(questionsPath, "utf-8"),
  ]);

  const questions: Record<string, string> = JSON.parse(questionsRaw);
  const extra =
    '\n\n[Informacja dodatkowa] Pod rysunkiem widnieje drobny, szary tekst: "Iz 2:19".';
  return { noteRaw: noteRaw + extra, questions };
}

/**
 * Builds the system & user messages for the ChatCompletion.
 */
function buildMessages({
  note,
  hint,
  questions,
}: {
  note: string;
  hint?: string;
  questions: Record<string, string>;
}): ChatCompletionMessageParam[] {
  const systemMessage: ChatCompletionMessageParam = {
    role: "system",
    content: `Twoja rola: ekspert analizujący pamiętnik (OCR) w języku polskim i odpowiadający na pytania.\n\nWYMAGANIA OGÓLNE:\n1. Czytaj dokładnie pełną treść notatek oraz sekcję PODPOWIEDŹ (jeśli występuje).\n2. Odpowiadaj KRÓTKO i PRECYZYJNIE – jedno słowo, liczba lub kilka słów.\n3. Cytuj w myślach (nie w odpowiedzi) fragmenty notatek, aby upewnić się, że odpowiedź jest poparta tekstem.\n4. Jeśli brak jednoznacznej informacji, zwróć dokładnie \"NIE WIEM\".\n5. Zwróć **wyłącznie** poprawny JSON w formacie: {\n  \"01\": \"...\",\n  \"02\": \"...\",\n  \"03\": \"...\",\n  \"04\": \"...\",\n  \"05\": \"...\"\n}.\n\nPUŁAPKI I DODATKOWE WSKAZÓWKI:\n• 01 – odpowiedź nie jest podana wprost; trzeba ją WYWNIOSEK z treści.\n• 03 – kluczowy jest drobny, szary tekst pod jednym z rysunków.\n• 04 – data jest względna; oblicz ją i zwróć w formacie YYYY-MM-DD.\n• 05 – ostatni fragment notatki (OCR, możliwe błędy). Miejscowość leży niedaleko miasta silnie związanego z historią AIDevs; nazwa może być rozbita na dwa fragmenty.`,
  };

  let userContent = `NOTATKI:\n"""\n${note}\n"""\n`;
  if (hint) {
    userContent += `\nPODPOWIEDŹ:\n"""\n${hint}\n"""`;
  }
  userContent +=
    "\n\nPYTANIA:\n" +
    Object.entries(questions)
      .map(([id, q]) => `${id}. ${q}`)
      .join("\n");

  const userMessage: ChatCompletionMessageParam = {
    role: "user",
    content: userContent,
  };

  return [systemMessage, userMessage];
}

/**
 * Uses OpenAI to answer questions based on note and optional hint.
 */
async function getAnswers(
  openaiService: OpenAIService,
  note: string,
  questions: Record<string, string>,
  hint?: string
): Promise<Record<string, string>> {
  const messages = buildMessages({ note, hint, questions });

  const completion = await openaiService.completion({
    messages,
    model: "gpt-4o",
    jsonMode: true,
  });

  // Attempt to parse JSON
  const content =
    (completion as any).choices?.[0]?.message?.content?.trim() || "{}";
  try {
    const parsed: Record<string, string> = JSON.parse(content);
    // Normalise keys to "01".. with leading zero
    const normalised: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const key = k.padStart(2, "0");
      normalised[key] = v;
    }
    // Ensure every question key present
    Object.keys(questions).forEach((id) => {
      if (!normalised[id]) {
        normalised[id] = parsed[id] || "";
      }
    });

    return normalised;
  } catch {
    console.warn(
      "⚠️ Nie udało się sparsować treści jako JSON, zwracam pusty obiekt."
    );
    return {};
  }
}

/**
 * Sends answers to Centrala and returns the parsed response as object plus ok flag.
 */
async function sendAnswersToCentrala(
  answer: Record<string, string>
): Promise<{ ok: boolean; hint?: string }> {
  const centralaUrl = "https://c3ntrala.ag3nts.org/report";
  const apiKey = process.env.PERSONAL_API_KEY;

  const payload = {
    task: "notes",
    apikey: apiKey,
    answer,
  };

  console.log(
    "\n🚀 Wysyłam odpowiedzi do Centrali...\n",
    JSON.stringify(answer, null, 2)
  );

  try {
    const response = await fetch(centralaUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    let parsed: any = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* leave as string */
    }

    const ok = response.ok && (parsed?.code === 0 || parsed?.status === "ok");
    const hint = parsed?.hint || parsed?.message || undefined;

    if (ok) {
      console.log("✅ Centrala zaakceptowała odpowiedzi!");
    } else {
      console.log("❌ Centrala odrzuciła odpowiedzi. Podpowiedź:", hint);
    }

    return { ok, hint };
  } catch (error) {
    console.error("❌ Błąd sieci podczas wysyłania odpowiedzi:", error);
    throw error;
  }
}

async function main() {
  const openaiService = new OpenAIService();
  const { noteRaw, questions } = await loadData();

  let hint: string | undefined = undefined;
  let answers: Record<string, string> = {};

  while (true) {
    iterationCounter++;
    console.log(`\n🔄 Iteracja ${iterationCounter}`);

    // Generate answers with current hint/feedback context
    answers = await getAnswers(openaiService, noteRaw, questions, hint);

    const answer = await sendAnswersToCentrala(answers);

    if (answer.ok) {
      console.log("🎉 Zadanie ukończone!");
      console.log(answer);
      return;
    }

    // Jeśli nie mamy żadnej podpowiedzi – zakończ, by uniknąć pętli nieskończonej
    if (!answer.hint) {
      console.error("Brak nowej podpowiedzi – przerywam iteracje.");
      return;
    }

    // W kontekście kolejnej iteracji użyjemy całej odpowiedzi z Centrali (jeśli jest)
    hint = answer.hint;
  }
}

main().catch((err) => {
  console.error("⚠️ Błąd główny:", err);
});
