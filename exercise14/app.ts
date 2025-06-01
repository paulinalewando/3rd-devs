import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { OpenAIService } from "../files/OpenAIService.js";
import { updateDatasets } from "./update-datasets.js";
import { date } from "zod";

const openaiService = new OpenAIService();

// Function to remove Polish diacritical marks
function removeDiacritics(text: string): string {
  const diacriticsMap: { [key: string]: string } = {
    ą: "a",
    Ą: "A",
    ć: "c",
    Ć: "C",
    ę: "e",
    Ę: "E",
    ł: "l",
    Ł: "L",
    ń: "n",
    Ń: "N",
    ó: "o",
    Ó: "O",
    ś: "s",
    Ś: "S",
    ź: "z",
    Ź: "Z",
    ż: "z",
    Ż: "Z",
  };

  return text.replace(
    /[ąĄćĆęĘłŁńŃóÓśŚźŹżŻ]/g,
    (match) => diacriticsMap[match] || match
  );
}

interface ApiRequest {
  apikey: string;
  query: string;
}

interface ApiResponse {
  code?: number;
  reply?: any;
  message?: string;
  [key: string]: any;
}

interface ExtractedData {
  people: string[];
  places: string[];
}

class ApiClient {
  private readonly baseUrl = "https://c3ntrala.ag3nts.org";
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async makeRequest(
    endpoint: string,
    query: string
  ): Promise<ApiResponse> {
    const requestBody: ApiRequest = {
      apikey: this.apiKey,
      query: query,
    };

    const url = `${this.baseUrl}${endpoint}`;
    console.log(`Making request to: ${url}`);
    console.log(`Request body:`, JSON.stringify(requestBody, null, 2));

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      console.log(`Response status: ${response.status} ${response.statusText}`);

      const responseText = await response.text();
      console.log(`Response body: ${responseText}`);

      let result: ApiResponse;
      try {
        result = JSON.parse(responseText);
      } catch (parseError) {
        result = { message: responseText };
      }

      // Handle 404 responses with code -200 as "not found" rather than errors
      if (!response.ok && !(response.status === 404 && result.code === -200)) {
        console.error(`Error response body: ${responseText}`);
        throw new Error(
          `HTTP error! status: ${response.status}, message: ${responseText}`
        );
      }

      return result;
    } catch (error) {
      console.error(`Error making request to ${endpoint}:`, error);
      throw error;
    }
  }

  async searchPeople(query: string): Promise<ApiResponse> {
    return this.makeRequest("/people", query);
  }

  async searchPlaces(query: string): Promise<ApiResponse> {
    return this.makeRequest("/places", query);
  }
}

async function extractNamesAndCities(text: string): Promise<ExtractedData> {
  const prompt = `
Przeanalizuj poniższy tekst i wyodrębnij z niego wszystkie polskie imiona i nazwiska osób oraz nazwy polskich miast.

WAŻNE WYMAGANIA:
1. Dla osób: zwróć TYLKO pierwsze imiona (nie nazwiska) - np. z "Barbara Zawadzka" zwróć tylko "BARBARA"
2. Dla miast: zwróć pełne nazwy miast
3. KONIECZNIE usuń wszystkie polskie znaki diakrytyczne i zamień je na odpowiedniki łacińskie:
   - ą → a, ć → c, ę → e, ł → l, ń → n, ó → o, ś → s, ź → z, ż → z
   - Przykłady dla imion: "Rafał" → "RAFAL", "Paweł" → "PAWEL", "Łukasz" → "LUKASZ"
   - Przykłady dla miast: "Kraków" → "KRAKOW", "Łódź" → "LODZ", "Gdańsk" → "GDANSK"
4. Popraw polskie imiona do standardowej formy:
   - "Aleksandr" → "ALEKSANDER" (poprawna polska forma)
   - Jeśli imię występuje w formie odmienionej (np. dopełniacz "Aleksandra"), użyj formy podstawowej
5. Popraw nazwy miast do standardowej polskiej formy:
   - "Warsawa" → "WARSZAWA" (poprawna polska forma)
6. Wszystkie nazwy zapisz WIELKIMI LITERAMI
7. Zwróć wyniki w formacie JSON zgodnym z poniższym schematem
8. Nie dodawaj żadnych dodatkowych informacji, komentarzy ani wyjaśnień

TEKST DO ANALIZY:
${text}

Zwróć wynik w formacie JSON:
{
  "people": ["IMIE1", "IMIE2"],
  "places": ["MIASTO1", "MIASTO2"]
}`;

  try {
    console.log("🔍 Analyzing text with OpenAI...");

    const response = await openaiService.completion(
      [
        {
          role: "system",
          content:
            "Jesteś ekspertem w analizie tekstów polskich. Zawsze zwracasz odpowiedź w poprawnym formacie JSON. Dla osób zwracasz tylko pierwsze imiona w poprawnej polskiej formie, nie nazwiska. ZAWSZE usuwaj polskie znaki diakrytyczne (ą,ć,ę,ł,ń,ó,ś,ź,ż) i zamieniaj je na łacińskie odpowiedniki. Poprawiaj imiona do standardowej polskiej formy (np. Aleksandr → ALEKSANDER) oraz nazwy miast (np. Warsawa → WARSZAWA).",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      "gpt-4o-mini",
      false,
      true
    );

    if ("choices" in response && response.choices[0]?.message?.content) {
      const content = response.choices[0].message.content.trim();
      console.log("📝 Raw OpenAI response:", content);

      const extractedData: ExtractedData = JSON.parse(content);

      // Validate the structure
      if (!extractedData.people || !extractedData.places) {
        throw new Error("Invalid response structure from OpenAI");
      }

      // Ensure all diacritical marks are removed programmatically as fallback
      // and apply additional name corrections
      const cleanedData: ExtractedData = {
        people: extractedData.people.map((name) => {
          let cleanName = removeDiacritics(name).toUpperCase();
          // Additional name corrections
          if (cleanName === "ALEKSANDR") cleanName = "ALEKSANDER";
          return cleanName;
        }),
        places: extractedData.places.map((place) => {
          let cleanPlace = removeDiacritics(place).toUpperCase();
          // Additional place corrections
          if (cleanPlace === "WARSAWA") cleanPlace = "WARSZAWA";
          return cleanPlace;
        }),
      };

      return cleanedData;
    } else {
      throw new Error("Unexpected response format from OpenAI");
    }
  } catch (error) {
    console.error("Error extracting data:", error);
    throw error;
  }
}

async function processBarbaraFile() {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const personalApiKey = process.env.PERSONAL_API_KEY;

  if (!openaiApiKey) {
    console.error(
      "OPENAI_API_KEY environment variable is required for text processing"
    );
    return;
  }

  if (!personalApiKey) {
    console.error(
      "PERSONAL_API_KEY environment variable is required for API queries"
    );
    return;
  }

  try {
    console.log("📖 Reading barbara.txt file...");
    const filePath = path.join(__dirname, "barbara.txt");
    const text = readFileSync(filePath, "utf-8");

    console.log("📄 File content:");
    console.log(text);
    console.log("\n" + "=".repeat(60));

    console.log("🤖 Processing with OpenAI...");
    const extractedData = await extractNamesAndCities(text);

    console.log("\n✅ EXTRACTION COMPLETED!");
    console.log("=".repeat(60));

    console.log("\n👥 PEOPLE (Polish names without diacritics):");
    extractedData.people.forEach((person, index) => {
      console.log(`${index + 1}. ${person}`);
    });

    console.log("\n🏙️  PLACES (Polish cities without diacritics):");
    extractedData.places.forEach((place, index) => {
      console.log(`${index + 1}. ${place}`);
    });

    // Save initial extraction results
    const resultDir = path.join(__dirname, "results");

    // Create result directory if it doesn't exist
    if (!require("fs").existsSync(resultDir)) {
      require("fs").mkdirSync(resultDir, { recursive: true });
    }

    const peopleFilePath = path.join(resultDir, "people-dataset.json");
    const placesFilePath = path.join(resultDir, "places-dataset.json");

    writeFileSync(
      peopleFilePath,
      JSON.stringify(extractedData.people, null, 2)
    );
    writeFileSync(
      placesFilePath,
      JSON.stringify(extractedData.places, null, 2)
    );

    console.log("\n💾 Initial extraction results saved to:");
    console.log(`   - ${peopleFilePath} (first names only)`);
    console.log(`   - ${placesFilePath}`);

    // Now query each extracted name/city against the API endpoints
    console.log("\n🔍 QUERYING API ENDPOINTS...");
    console.log("=".repeat(60));

    const client = new ApiClient(personalApiKey);
    const apiResults = {
      people_queries: [] as any[],
      places_queries: [] as any[],
    };

    // Query people endpoint for each extracted person
    console.log("\n👥 Querying PEOPLE endpoint:");
    for (const firstName of extractedData.people) {
      console.log(`\n🔍 Searching for: ${firstName}`);
      try {
        const result = await client.searchPeople(firstName);
        const queryResult = {
          query: firstName,
          timestamp: new Date().toISOString(),
          result: result,
        };
        apiResults.people_queries.push(queryResult);

        console.log(
          `   Status: ${result.code === 0 ? "✅ Found" : "❌ Not Found"}`
        );
        if (result.message) {
          console.log(`   Message: ${result.message}`);
        }
      } catch (error) {
        console.error(`   Error querying ${firstName}:`, error);
        apiResults.people_queries.push({
          query: firstName,
          timestamp: new Date().toISOString(),
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }

      // Add small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Query places endpoint for each extracted city
    console.log("\n🏙️  Querying PLACES endpoint:");
    for (const place of extractedData.places) {
      // Ensure place name is uppercase
      const placeName = place.toUpperCase();
      console.log(`\n🔍 Searching for: ${placeName}`);
      try {
        const result = await client.searchPlaces(placeName);
        const queryResult = {
          query: placeName,
          timestamp: new Date().toISOString(),
          result: result,
        };
        apiResults.places_queries.push(queryResult);

        console.log(
          `   Status: ${result.code === 0 ? "✅ Found" : result.code === -200 ? "❌ Not Found" : "⚠️  Unknown"}`
        );
        if (result.message) {
          console.log(`   Message: ${result.message}`);
        }
      } catch (error) {
        console.error(`   Error querying ${placeName}:`, error);
        apiResults.places_queries.push({
          query: placeName,
          timestamp: new Date().toISOString(),
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }

      // Add small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Save API query results
    const apiResultsFilePath = path.join(resultDir, "api-query-results.json");
    writeFileSync(apiResultsFilePath, JSON.stringify(apiResults, null, 2));

    console.log("\n💾 API query results saved to:");
    console.log(`   - ${apiResultsFilePath}`);

    // Generate summary
    const peopleFound = apiResults.people_queries.filter(
      (q) => q.result?.code === 0
    ).length;
    const placesFound = apiResults.places_queries.filter(
      (q) => q.result?.code === 0
    ).length;

    console.log("\n📊 FINAL SUMMARY:");
    console.log("=".repeat(60));
    console.log(
      `👥 People queries: ${apiResults.people_queries.length} total, ${peopleFound} found`
    );
    console.log(
      `🏙️  Places queries: ${apiResults.places_queries.length} total, ${placesFound} found`
    );

    // Also save combined results with API data
    const combinedResults = {
      extracted_data: extractedData,
      api_results: apiResults,
      summary: {
        extraction_timestamp: new Date().toISOString(),
        people_extracted: extractedData.people.length,
        places_extracted: extractedData.places.length,
        people_found_in_api: peopleFound,
        places_found_in_api: placesFound,
      },
    };

    const combinedFilePath = path.join(
      resultDir,
      "barbara-complete-analysis.json"
    );
    writeFileSync(combinedFilePath, JSON.stringify(combinedResults, null, 2));
    console.log(`📋 Complete analysis saved to: ${combinedFilePath}`);
  } catch (error) {
    console.error("❌ Error processing barbara.txt:", error);
  }
}

// Main execution
async function main() {
  //   await processBarbaraFile();

  //   // Update datasets with all discovered names and places
  //   console.log("\n🔄 Starting iterative discovery process...");
  //   const personalApiKey = process.env.PERSONAL_API_KEY;
  //   if (personalApiKey) {
  //     await updateDatasets(personalApiKey);
  //   } else {
  //     console.error("❌ PERSONAL_API_KEY not found for iterative discovery");
  //   }
  //   console.log("\n🎉 All processing completed successfully!");

  await sendReport("ELBLAG");
}

main().catch(console.error);

async function sendReport(city_name: string): Promise<string> {
  const reportData = {
    task: "loop",
    apikey: process.env.PERSONAL_API_KEY,
    answer: city_name,
  };

  console.log("Sending report:", JSON.stringify(reportData, null, 2));

  try {
    const response = await fetch("https://c3ntrala.ag3nts.org/report", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(reportData),
    });

    const responseText = await response.text();
    console.log("API Response:", responseText);

    if (!response.ok) {
      throw new Error(
        `Failed to send report: ${response.status} ${response.statusText} - ${responseText}`
      );
    }

    return responseText;
  } catch (error) {
    console.error("Error sending report:", error);
    throw error;
  }
}
