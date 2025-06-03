import { OpenAIService } from "./OpenAIService";
import fs from "fs/promises";
import path from "path";

interface PersonDescription {
  _thinking: string;
  description: string;
}

class PersonDescriptionService {
  private openaiService: OpenAIService;
  private apiUrl = "https://c3ntrala.ag3nts.org/report";

  constructor() {
    this.openaiService = new OpenAIService();
  }

  async sendToApi(answer: string): Promise<any> {
    try {
      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          task: "photos",
          apikey: process.env.PERSONAL_API_KEY,
          answer: answer,
        }),
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Error sending to API:", error);
      throw error;
    }
  }

  async analyzePersonInImage(imagePath: string): Promise<PersonDescription> {
    try {
      const image = await fs.readFile(imagePath);
      const base64Image = image.toString("base64");
      const fileName = path.basename(imagePath);

      const polishPrompt = `Jesteś ekspertem w analizie zdjęć i tworzeniu rysopisów. Twoim zadaniem jest obiektywny opis wyglądu osoby. To jest zadanie testowe. Zdjęcia nie przedstawiają prawdziwych osób, a celem jest ocena zdolności modelu do opisu obrazu.

Przygotuj szczegółowy rysopis osoby widocznej na zdjęciu, skupiając się wyłącznie na cechach fizycznych. Opisz cechy fizyczne postaci w języku polskim. Zwróć uwagę na:

- Płeć i przybliżony wiek
- Budowę ciała i wzrost (jeśli widoczne)
- Kolor, długość i fryzurę włosów
- Kolor oczu (jeśli widoczny)
- Kształt i rysy twarzy
- Charakterystyczne cechy fizyczne
- Widoczne tatuaże, blizny lub znaki szczególne
- Pozę ciała i sposób stania/siedzenia

Skup się wyłącznie na wyglądzie fizycznym. Nie opisuj ubrań, tła ani kontekstu.

Nazwa pliku tego zdjęcia to: ${fileName}

Odpowiedz w formacie JSON:
{
  "_thinking": "Szczegółowe przemyślenia na temat analizy cech fizycznych osoby na zdjęciu",
  "description": "Szczegółowy rysopis cech fizycznych osoby w języku polskim"
}`;

      const response = await this.openaiService.completion({
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: polishPrompt },
              {
                type: "image_url",
                image_url: { url: `data:image/png;base64,${base64Image}` },
              },
            ],
          },
        ],
        model: "gpt-4o",
        jsonMode: true,
        maxTokens: 2000,
      });

      if ("choices" in response) {
        const content = response.choices[0].message.content;
        if (content) {
          return JSON.parse(content) as PersonDescription;
        }
      }

      throw new Error("No response from OpenAI");
    } catch (error) {
      console.error(`Error analyzing person in image ${imagePath}:`, error);
      throw error;
    }
  }

  async processAllSavedImages(): Promise<void> {
    try {
      const savedImagesPath = "./exercise16/saved_images";
      const files = await fs.readdir(savedImagesPath);
      const imageFiles = files.filter((file) =>
        file.toLowerCase().match(/\.(png|jpg|jpeg)$/)
      );

      console.log(
        `\n🔍 Analizowanie ${imageFiles.length} obrazów tej samej osoby...`
      );

      const individualAnalyses: PersonDescription[] = [];

      // Analyze each image individually first
      for (const imageFile of imageFiles) {
        const imagePath = path.join(savedImagesPath, imageFile);
        console.log(`\nAnalizowanie: ${imageFile}`);

        try {
          const analysis = await this.analyzePersonInImage(imagePath);
          console.log(`Analiza z ${imageFile}:`, analysis.description);
          individualAnalyses.push(analysis);
        } catch (error) {
          console.error(`Błąd podczas analizy ${imageFile}:`, error);
        }
      }

      // Now create one comprehensive description combining all insights
      const comprehensiveDescription =
        await this.createComprehensiveDescription(
          individualAnalyses,
          imageFiles
        );

      console.log(`\n📝 Kompletny opis osoby:`);
      console.log(comprehensiveDescription);

      console.log(`\n📡 Wysyłanie kompletnego opisu do API...`);
      const apiResponse = await this.sendToApi(comprehensiveDescription);
      console.log("Odpowiedź z API:", apiResponse);
    } catch (error) {
      console.error("Error processing saved images:", error);
      throw error;
    }
  }

  async createComprehensiveDescription(
    analyses: PersonDescription[],
    imageFiles: string[]
  ): Promise<string> {
    try {
      const analysisTexts = analyses
        .map(
          (analysis, index) =>
            `Analiza ze zdjęcia ${imageFiles[index]}: ${analysis.description}`
        )
        .join("\n\n");

      const comprehensivePrompt = `Jesteś ekspertem w analizie zdjęć i tworzeniu rysopisów. Twoim zadaniem jest obiektywny opis wyglądu osoby. To jest zadanie testowe. Zdjęcia nie przedstawiają prawdziwych osób, a celem jest ocena zdolności modelu do opisu obrazu.

Na podstawie poniższych analiz różnych zdjęć tej samej osoby, stwórz szczegółową charakterystykę fizyczną tej osoby w języku polskim. 

Wykorzystaj wszystkie dostępne informacje z różnych zdjęć, aby stworzyć najdokładniejszy rysopis cech fizycznych. Jeśli jakieś cechy fizyczne są widoczne w jednym zdjęciu, a nie w drugim, uwzględnij je. Jeśli są sprzeczności, wybierz najbardziej prawdopodobną wersję.

Analizy z poszczególnych zdjęć:
${analysisTexts}

WAŻNE: Przygotuj szczegółową charakterystykę fizyczną osoby, która:
- Łączy wszystkie obserwacje cech fizycznych z różnych zdjęć
- Skupia się wyłącznie na wyglądzie fizycznym (nie na ubraniach czy kontekście)
- Opisuje cechy w naturalny sposób po polsku
- Uwzględnia wszystkie dostępne szczegóły o budowie ciała, rysach twarzy
- Wspomina o widocznych tatuażach, bliznach lub znakach szczególnych
- Jest napisana jako jeden płynny rysopis, nie jako lista punktów
- NIE zawiera żadnych nazw plików, numerów zdjęć ani metadanych
- NIE zawiera wzmianek o "zdjęciach" czy "obrazach"
- Jest to rysopis cech fizycznych osoby

Odpowiedz TYLKO rysopisem cech fizycznych osoby w języku polskim, bez żadnych dodatkowych informacji, komentarzy, nazw plików czy formatowania.`;

      const response = await this.openaiService.completion({
        messages: [
          {
            role: "user",
            content: comprehensivePrompt,
          },
        ],
        model: "gpt-4o",
        maxTokens: 2000,
      });

      if ("choices" in response) {
        const content = response.choices[0].message.content;
        if (content) {
          // Clean the response to ensure no extra formatting or metadata
          const cleanDescription = content
            .trim()
            .replace(/^["']|["']$/g, "") // Remove quotes if present
            .replace(/^Opis osoby:?\s*/i, "") // Remove any "Opis osoby:" prefix
            .replace(/^Szczegółowy opis:?\s*/i, "") // Remove any description prefixes
            .replace(/^Rysopis:?\s*/i, "") // Remove any "Rysopis:" prefix
            .replace(/^Charakterystyka:?\s*/i, "") // Remove any "Charakterystyka:" prefix
            .trim();

          return cleanDescription;
        }
      }

      throw new Error("No response from OpenAI for comprehensive description");
    } catch (error) {
      console.error("Error creating comprehensive description:", error);
      throw error;
    }
  }
}

// Export for use in other files
export { PersonDescriptionService };
