import { OpenAIService } from "./OpenAIService";
import { promises as fs } from "fs";
import path from "path";

interface ExtractedInfo {
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

class FactExtractor {
  private openaiService: OpenAIService;

  constructor() {
    this.openaiService = new OpenAIService();
  }

  async extractFromFile(filePath: string): Promise<ExtractedInfo> {
    const content = await fs.readFile(filePath, "utf-8");
    const fileName = path.basename(filePath);

    const prompt = `
Przeanalizuj poniższy tekst i wyekstrahuj kluczowe informacje w formacie JSON.

Szukaj następujących informacji:
1. Osoby - imiona, nazwiska, zawody, umiejętności, relacje z innymi osobami
2. Miejsca/lokacje - nazwy sektorów, miast, ulic, budynków
3. Organizacje - nazwy firm, grup, ruchów
4. Technologie - sprzęt, oprogramowanie, systemy
5. Kluczowe fakty - ważne informacje, które mogą być przydatne

Tekst do analizy:
${content}

Odpowiedz w formacie JSON zgodnym z tym schematem:
{
  "fileName": "nazwa_pliku",
  "people": [
    {
      "name": "imię i nazwisko",
      "profession": "zawód/funkcja",
      "skills": ["umiejętność1", "umiejętność2"],
      "location": "miejsce zamieszkania/pracy",
      "relationships": ["związek z osobą X", "znajomość z Y"],
      "other_info": ["inne ważne informacje"]
    }
  ],
  "locations": [
    {
      "name": "nazwa miejsca",
      "description": "opis miejsca",
      "purpose": "przeznaczenie/funkcja"
    }
  ],
  "organizations": ["nazwa organizacji1", "nazwa organizacji2"],
  "technologies": ["technologia1", "technologia2"],
  "key_facts": ["fakt1", "fakt2"]
}

Jeśli jakiejś kategorii nie ma w tekście, zostaw pustą tablicę.
`;

    try {
      const response = await this.openaiService.completion(
        [
          {
            role: "user",
            content: prompt,
          },
        ],
        "gpt-4o",
        false,
        true
      );

      if ("choices" in response && response.choices[0]?.message?.content) {
        const extractedData = JSON.parse(response.choices[0].message.content);
        extractedData.fileName = fileName;
        return extractedData;
      } else {
        throw new Error("Unexpected response format");
      }
    } catch (error) {
      console.error(`Error processing file ${fileName}:`, error);
      return {
        fileName,
        people: [],
        locations: [],
        organizations: [],
        technologies: [],
        key_facts: [],
      };
    }
  }

  async processAllFiles(): Promise<ExtractedInfo[]> {
    const factsDir = path.join(__dirname, "files", "facts");
    const files = await fs.readdir(factsDir);
    const txtFiles = files.filter((file) => file.endsWith(".txt"));

    console.log(`Found ${txtFiles.length} fact files to process...`);

    const results: ExtractedInfo[] = [];

    for (const file of txtFiles) {
      console.log(`Processing ${file}...`);
      const filePath = path.join(factsDir, file);
      const extracted = await this.extractFromFile(filePath);
      results.push(extracted);
    }

    return results;
  }

  async saveResults(results: ExtractedInfo[]): Promise<void> {
    // Save detailed results
    const detailedPath = path.join(__dirname, "extracted-facts-detailed.json");
    await fs.writeFile(detailedPath, JSON.stringify(results, null, 2));
    console.log(`Detailed results saved to: ${detailedPath}`);
  }
}

export { FactExtractor };
export type { ExtractedInfo };
