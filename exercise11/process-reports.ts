import { OpenAIService } from "./OpenAIService";
import { promises as fs } from "fs";
import path from "path";

interface ReportKeywords {
  fileName: string;
  content: string;
  initialKeywords: string[];
  people: string[];
  places: string[];
  matchedFacts: string[];
  combinedKeywords: string[];
}

interface ExtractedFact {
  fileName: string;
  people: Array<{
    name: string;
    profession?: string;
    skills?: string[];
    location?: string;
    relationships?: string[];
    other_info?: string[];
  }>;
  locations: Array<{
    name: string;
    description: string;
    purpose?: string;
  }>;
  organizations: string[];
  technologies: string[];
  key_facts: string[];
}

class ReportProcessor {
  private openaiService: OpenAIService;
  private extractedFacts: ExtractedFact[] = [];

  constructor() {
    this.openaiService = new OpenAIService();
  }

  async loadExtractedFacts(): Promise<void> {
    const factsPath = path.join(__dirname, "extracted-facts-detailed.json");
    const factsContent = await fs.readFile(factsPath, "utf-8");
    this.extractedFacts = JSON.parse(factsContent);
  }

  async processReport(filePath: string): Promise<ReportKeywords> {
    const content = await fs.readFile(filePath, "utf-8");
    const fileName = path.basename(filePath);

    // Generate initial keywords and identify people/places
    const analysisPrompt = `
Przeanalizuj poniższy raport bezpieczeństwa i wyekstrahuj:

1. Słowa kluczowe opisujące treść raportu (10-15 słów)
2. Osoby wspomniane w raporcie (imiona i nazwiska)
3. Miejsca wspomniane w raporcie (sektory, lokacje)

Raport:
Nazwa pliku: ${fileName}
Treść: ${content}

Odpowiedz w formacie JSON:
{
  "keywords": ["słowo1", "słowo2", "słowo3"],
  "people": ["Imię Nazwisko", "Inne Imię"],
  "places": ["Sektor A", "miejsce2"]
}
`;

    try {
      const response = await this.openaiService.completion(
        [{ role: "user", content: analysisPrompt }],
        "gpt-4o",
        false,
        true
      );

      if ("choices" in response && response.choices[0]?.message?.content) {
        const analysis = JSON.parse(response.choices[0].message.content);

        // Find matching facts
        const matchedFacts = await this.findMatchingFacts(
          analysis.people,
          analysis.places,
          analysis.keywords,
          content,
          fileName
        );

        // Generate combined keywords
        const combinedKeywords = await this.generateCombinedKeywords(
          analysis.keywords,
          matchedFacts,
          content
        );

        return {
          fileName,
          content,
          initialKeywords: analysis.keywords || [],
          people: analysis.people || [],
          places: analysis.places || [],
          matchedFacts,
          combinedKeywords,
        };
      }
    } catch (error) {
      console.error(`Error processing report ${fileName}:`, error);
    }

    return {
      fileName,
      content,
      initialKeywords: [],
      people: [],
      places: [],
      matchedFacts: [],
      combinedKeywords: [],
    };
  }

  private async findMatchingFacts(
    people: string[],
    places: string[],
    keywords: string[],
    reportContent: string,
    fileName: string
  ): Promise<string[]> {
    const factsText = this.extractedFacts
      .map((fact) => {
        const peopleInfo = fact.people
          .map((p) => `${p.name} (${p.profession || "nieznany zawód"})`)
          .join(", ");
        const locationInfo = fact.locations
          .map((l) => `${l.name}: ${l.description}`)
          .join(", ");
        return `Plik: ${fact.fileName}
Osoby: ${peopleInfo}
Miejsca: ${locationInfo}
Technologie: ${fact.technologies.join(", ")}
Fakty: ${fact.key_facts.join(" | ")}`;
      })
      .join("\n\n");

    const matchingPrompt = `
Przeanalizuj raport bezpieczeństwa i znajdź wszystkie powiązane fakty z bazy wiedzy.

RAPORT: ${fileName}
TREŚĆ: ${reportContent}
WYKRYTE OSOBY: ${people.join(", ") || "brak"}
WYKRYTE MIEJSCA: ${places.join(", ") || "brak"}
SŁOWA KLUCZOWE: ${keywords.join(", ")}

BAZA FAKTÓW:
${factsText}

ZADANIE - znajdź wszystkie pasujące fakty i SZCZEGÓLNIE:
1. Jeśli w raporcie jest osoba, sprawdź jej zawód/profesję w faktach
2. Zwróć uwagę na błędy w pisowni nazwisk (Ragowski/Ragorski to ta sama osoba)
3. Jeśli osoba z raportu to nauczyciel - KONIECZNIE to zaznacz jako "Osoba: [Imię] - nauczyciel"
4. Jeśli osoba z raportu to programista (JavaScript, Python, Java) - KONIECZNIE to zaznacz jako "Osoba: [Imię] - programista [język]"
5. Znajdź fakty o miejscach i technologiach z raportu

UWAGI:
- Aleksander Ragowski = Aleksander Ragorski (ta sama osoba)
- Barbara Zawadzka potrafi JavaScript i Python
- Przekazanie do działu kontroli = schwytanie/zatrzymanie

Zwróć listę powiązanych faktów w formacie:
Osoba: [imię] - [zawód/umiejętności]
Miejsce: [nazwa] - [opis]
Technologie: [lista]
Fakt: [szczegóły]`;

    try {
      const response = await this.openaiService.completion(
        [{ role: "user", content: matchingPrompt }],
        "gpt-4o",
        false,
        false
      );

      if ("choices" in response && response.choices[0]?.message?.content) {
        const content = response.choices[0].message.content.trim();
        return content
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
      }
    } catch (error) {
      console.error(`Error matching facts for ${fileName}:`, error);
    }

    return [];
  }

  private async generateCombinedKeywords(
    initialKeywords: string[],
    matchedFacts: string[],
    reportContent: string
  ): Promise<string[]> {
    if (matchedFacts.length === 0) {
      return initialKeywords;
    }

    const combinationPrompt = `
Na podstawie raportu i powiązanych faktów, wygeneruj rozszerzoną listę słów kluczowych.

TREŚĆ RAPORTU: ${reportContent}

POWIĄZANE FAKTY:
${matchedFacts.slice(0, 10).join("\n")}

POCZĄTKOWE SŁOWA KLUCZOWE: ${initialKeywords.join(", ")}

SPECJALNE ZASADY:
- Jeśli raport mówi o przekazaniu/zatrzymaniu nauczyciela - dodaj: "schwytanie", "nauczyciel"
- Jeśli raport wspomina osobę będącą programistą JavaScript/Python - dodaj: "programista", "JavaScript" lub "Python"
- Jeśli znajdują się odciski palców programisty - dodaj: "ślad programisty", "analiza odcisków"
- Zachowaj wszystkie imiona i nazwiska osób
- Dodaj specyficzne technologie i miejsca

Wygeneruj listę 15-25 słów kluczowych łączących raport z faktami.
Odpowiedz tylko listą słów oddzielonych przecinkami:
`;

    try {
      const response = await this.openaiService.completion(
        [{ role: "user", content: combinationPrompt }],
        "gpt-4o",
        false,
        false
      );

      if ("choices" in response && response.choices[0]?.message?.content) {
        const combinedText = response.choices[0].message.content.trim();
        return combinedText
          .split(",")
          .map((keyword) => keyword.trim())
          .filter((k) => k.length > 0);
      }
    } catch (error) {
      console.error("Error generating combined keywords:", error);
    }

    return initialKeywords;
  }

  async processAllReports(): Promise<ReportKeywords[]> {
    await this.loadExtractedFacts();

    const reportsDir = path.join(__dirname, "files", "reports");
    const files = await fs.readdir(reportsDir);
    const txtFiles = files.filter((file) => file.endsWith(".txt"));

    console.log(`Found ${txtFiles.length} report files to process...`);

    const results: ReportKeywords[] = [];

    for (const file of txtFiles) {
      console.log(`Processing report ${file}...`);
      const filePath = path.join(reportsDir, file);
      const processed = await this.processReport(filePath);
      results.push(processed);
    }

    return results;
  }

  async saveResults(results: ReportKeywords[]): Promise<void> {
    const outputPath = path.join(__dirname, "processed-reports.json");
    await fs.writeFile(outputPath, JSON.stringify(results, null, 2));
    console.log(`Processed reports saved to: ${outputPath}`);

    // Create a summary for quick overview
    const summary = results.map((report) => ({
      fileName: report.fileName,
      people: report.people,
      places: report.places,
      keywordsCount: report.combinedKeywords.length,
      factsMatchedCount: report.matchedFacts.length,
    }));

    const summaryPath = path.join(__dirname, "reports-summary.json");
    await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));
    console.log(`Reports summary saved to: ${summaryPath}`);
  }
}

async function main() {
  const processor = new ReportProcessor();

  try {
    console.log("Starting report processing...");
    const results = await processor.processAllReports();

    console.log("Saving results...");
    await processor.saveResults(results);

    console.log("Report processing completed successfully!");
    console.log(`Processed ${results.length} reports`);

    // Display summary
    results.forEach((report) => {
      console.log(`\n${report.fileName}:`);
      console.log(`  People: ${report.people.join(", ") || "none"}`);
      console.log(`  Places: ${report.places.join(", ") || "none"}`);
      console.log(`  Keywords: ${report.combinedKeywords.length}`);
      console.log(`  Matched facts: ${report.matchedFacts.length}`);
    });
  } catch (error) {
    console.error("Error during report processing:", error);
    process.exit(1);
  }
}

// Execute if run directly
if (require.main === module) {
  main();
}

export { ReportProcessor };
export type { ReportKeywords };
