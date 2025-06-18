import express from "express";
import { OpenAIService } from "./OpenAIService";
import path from "path";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const openaiService = new OpenAIService();

// Map grid: [row][col], 1-based indexing
const mapDescriptions: string[][] = [
  ["punkt startowy", "łąka", "drzewo", "dom"],
  ["łąka", "wiatrak", "łąka", "łąka"],
  ["łąka", "łąka", "skały", "dwa drzewa"],
  ["skały", "skały", "samochód", "jaskinia"],
];

function getPositionFromInstruction(instruction: string): [number, number] {
  // Start at [1,1] (0,0 in 0-based)
  let row = 0,
    col = 0;
  // Normalize instruction
  const lower = instruction.toLowerCase();
  // Simple movement parsing (expand as needed)
  // Example: "poleciałem jedno pole w prawo, a później na sam dół"
  // Supported: prawo, lewo, dół, góra, liczba pól
  const moves = lower.split(/,|a później|następnie|potem/);
  for (let move of moves) {
    move = move.trim();
    let count = 1;
    const match = move.match(/(\d+)\s*pole/);
    if (match) count = parseInt(match[1], 10);
    if (move.includes("prawo")) col = Math.min(3, col + count);
    if (move.includes("lewo")) col = Math.max(0, col - count);
    if (move.includes("dół")) row = Math.min(3, row + count);
    if (move.includes("góra")) row = Math.max(0, row - count);
  }
  return [row, col];
}

// POST endpoint for drone instruction
//@ts-ignore
app.post("/api/instruction", async (req, res) => {
  const { instruction } = req.body;
  if (typeof instruction !== "string") {
    return res.status(400).json({ error: "Brak lub nieprawidłowa instrukcja" });
  }

  // Prepare a detailed prompt for the model
  const mapDescription = `Mapa to siatka 4x4. Każde pole ma swój opis:
[1,1] punkt startowy  [1,2] łąka         [1,3] drzewo      [1,4] dom
[2,1] łąka           [2,2] wiatrak      [2,3] łąka        [2,4] łąka
[3,1] łąka           [3,2] łąka         [3,3] skały       [3,4] dwa drzewa
[4,1] skały          [4,2] skały        [4,3] samochód    [4,4] jaskinia

Dron zawsze startuje z pozycji [1,1]. 
Ruch "w prawo" oznacza zwiększenie kolumny (1→2→3→4).
Ruch "w lewo" oznacza zmniejszenie kolumny (4→3→2→1).
Ruch "w dół" oznacza zwiększenie wiersza (1→2→3→4).
Ruch "w górę" oznacza zmniejszenie wiersza (4→3→2→1).
"Na sam dół" oznacza przejście do wiersza 4.
"Na samą górę" oznacza przejście do wiersza 1.

Przeanalizuj instrukcję ruchu krok po kroku:
1. Zacznij od [1,1]
2. Wykonaj każdy ruch po kolei
3. Podaj końcową pozycję
4. Podaj opis pola końcowego

Odpowiedź zwróć w formacie JSON: {"reasoning": "<krok po kroku>", "final_position": "[x,y]", "description": "<krótki opis>"}.`;

  const userPrompt = `Instrukcja lotu drona: ${instruction}`;

  try {
    const completion = await openaiService.completion({
      messages: [
        { role: "system", content: mapDescription },
        { role: "user", content: userPrompt },
      ],
      model: "gpt-4o",
      jsonMode: true,
    });
    let description = "";
    if (
      completion &&
      "choices" in completion &&
      completion.choices[0].message.content
    ) {
      // Log the full response for debugging
      console.log("AI Response:", completion.choices[0].message.content);

      // Try to parse as JSON
      try {
        const parsed = JSON.parse(completion.choices[0].message.content);
        console.log("Parsed response:", parsed);
        description = parsed.description || "";
      } catch {
        description = completion.choices[0].message.content.trim();
      }
    }
    res.status(200).json({ description });
  } catch (error) {
    res.status(500).json({ error: "Błąd podczas generowania odpowiedzi." });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
