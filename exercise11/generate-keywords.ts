import { OpenAIService } from "./OpenAIService";
import { promises as fs } from "fs";
import path from "path";

interface ProcessedReport {
  fileName: string;
  content: string;
  initialKeywords: string[];
  people: string[];
  places: string[];
  matchedFacts: string[];
  combinedKeywords: string[];
}

interface KeywordAnalysis {
  fileName: string;
  fileNameInfo: {
    date: string;
    reportNumber: string;
    sector: string;
  };
  content: string;
  peopleInvolved: string[];
  placesInvolved: string[];
  matchedFacts: string[];
  polishKeywords: string[];
}

class KeywordGenerator {
  private openaiService: OpenAIService;

  constructor() {
    this.openaiService = new OpenAIService();
  }

  private parseFileName(fileName: string) {
    // Extract date, report number, and sector from filename
    // Example: 2024-11-12_report-07-sektor_C4.txt
    const match = fileName.match(
      /(\d{4}-\d{2}-\d{2})_report-(\d+)-sektor_([A-Z]\d+)\.txt/
    );

    if (match) {
      return {
        date: match[1],
        reportNumber: match[2],
        sector: match[3],
      };
    }

    return {
      date: "nieznana",
      reportNumber: "nieznany",
      sector: "nieznany",
    };
  }

  async generatePolishKeywords(report: ProcessedReport): Promise<string[]> {
    const fileNameInfo = this.parseFileName(report.fileName);

    const keywordPrompt = `
Wygeneruj ESENCJONALNE słowa kluczowe dla raportu bezpieczeństwa:

RAPORT: ${report.fileName}
SEKTOR: ${fileNameInfo.sector}
DATA: ${fileNameInfo.date}

TREŚĆ: ${report.content}

OSOBY: ${report.people.join(", ") || "brak"}
MIEJSCA: ${report.places.join(", ") || "brak"}

POWIĄZANE FAKTY (najważniejsze):
${report.matchedFacts.slice(0, 8).join("\n")}

UWAGA SPECJALNA: 
- Jeśli raport opisuje schwytanie/zatrzymanie/przekazanie osoby, która jest nauczycielem - KONIECZNIE użyj słów: "schwytanie", "nauczyciel"
- Zwróć uwagę na możliwe błędy w pisowni nazwisk (np. Ragowski/Ragorski to ta sama osoba)
- Aleksander Ragowski/Ragorski to nauczyciel języka angielskiego
- Jeśli raport wspomina Barbarę Zawadzką - KONIECZNIE dodaj: "programista", "JavaScript" (jest specjalistką JavaScript)
- Jeśli fakty wspominają JavaScript, Python, lub programowanie - ZAWSZE dodaj te słowa do keywords

ZASADY:
- TYLKO najważniejsze słowa kluczowe
- Polski, mianownik 
- Konkretne dla tego raportu
- Zwierzęta/fauna = "zwierzęta"
- Imiona i nazwiska jeśli istotne
- Maksymalnie 15-20 słów
- Oddzielone przecinkami

Przykład dobrej jakości: "schwytanie,nauczyciel,Aleksander Ragowski,sektor C4,patrol"
Dla programisty: "Barbara Zawadzka,JavaScript,programista,odciski palców,sektor C4"

Odpowiedz TYLKO słowami kluczowymi:
`;

    try {
      const response = await this.openaiService.completion(
        [{ role: "user", content: keywordPrompt }],
        "gpt-4o",
        false,
        false
      );

      if ("choices" in response && response.choices[0]?.message?.content) {
        const keywordsText = response.choices[0].message.content.trim();
        return keywordsText
          .split(",")
          .map((keyword) => keyword.trim())
          .filter((keyword) => keyword.length > 0);
      }
    } catch (error) {
      console.error(`Error generating keywords for ${report.fileName}:`, error);
    }

    return [];
  }

  async processAllReports(): Promise<KeywordAnalysis[]> {
    // Load processed reports
    const processedReportsPath = path.join(__dirname, "processed-reports.json");
    const processedReportsContent = await fs.readFile(
      processedReportsPath,
      "utf-8"
    );
    const processedReports: ProcessedReport[] = JSON.parse(
      processedReportsContent
    );

    console.log(
      `Found ${processedReports.length} processed reports to analyze...`
    );

    const results: KeywordAnalysis[] = [];

    for (const report of processedReports) {
      console.log(`\nGenerating Polish keywords for ${report.fileName}...`);

      const fileNameInfo = this.parseFileName(report.fileName);
      const polishKeywords = await this.generatePolishKeywords(report);

      const analysis: KeywordAnalysis = {
        fileName: report.fileName,
        fileNameInfo,
        content: report.content,
        peopleInvolved: report.people,
        placesInvolved: report.places,
        matchedFacts: report.matchedFacts,
        polishKeywords,
      };

      results.push(analysis);

      // Display results immediately
      console.log(
        `  File info: ${fileNameInfo.date}, Report ${fileNameInfo.reportNumber}, Sector ${fileNameInfo.sector}`
      );
      console.log(`  People: ${report.people.join(", ") || "none"}`);
      console.log(`  Places: ${report.places.join(", ") || "none"}`);
      console.log(`  Matched facts: ${report.matchedFacts.length}`);
      console.log(
        `  Polish keywords (${polishKeywords.length}): ${polishKeywords.join(", ")}`
      );
    }

    return results;
  }

  async saveResults(results: KeywordAnalysis[]): Promise<void> {
    // Save complete analysis
    const analysisPath = path.join(__dirname, "final-keywords-analysis.json");
    await fs.writeFile(analysisPath, JSON.stringify(results, null, 2));
    console.log(`\nFinal analysis saved to: ${analysisPath}`);

    // Create simple keywords mapping
    const keywordsMapping = results.reduce(
      (acc, result) => {
        acc[result.fileName] = result.polishKeywords.join(",");
        return acc;
      },
      {} as Record<string, string>
    );

    const keywordsPath = path.join(__dirname, "final-keywords.json");
    await fs.writeFile(keywordsPath, JSON.stringify(keywordsMapping, null, 2));
    console.log(`Keywords mapping saved to: ${keywordsPath}`);

    // Create summary for API submission
    const apiFormat = results.reduce(
      (acc, result) => {
        // Keep the full filename with .txt extension for API
        acc[result.fileName] = result.polishKeywords.join(",");
        return acc;
      },
      {} as Record<string, string>
    );

    const apiPath = path.join(__dirname, "keywords-for-api.json");
    await fs.writeFile(apiPath, JSON.stringify(apiFormat, null, 2));
    console.log(`API format saved to: ${apiPath}`);
  }
}

async function main() {
  const generator = new KeywordGenerator();

  try {
    console.log("Starting Polish keyword generation from processed reports...");
    const results = await generator.processAllReports();

    console.log("\nSaving results...");
    await generator.saveResults(results);

    console.log("\nKeyword generation completed successfully!");
    console.log(`Generated keywords for ${results.length} reports`);
  } catch (error) {
    console.error("Error during keyword generation:", error);
    process.exit(1);
  }
}

// Execute if run directly
if (require.main === module) {
  main();
}

export { KeywordGenerator };
export type { KeywordAnalysis };
