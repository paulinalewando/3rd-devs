import { readFileSync, writeFileSync } from "fs";
import path from "path";

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

interface DiscoveredData {
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

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      const responseText = await response.text();
      let result: ApiResponse;
      try {
        result = JSON.parse(responseText);
      } catch (parseError) {
        result = { message: responseText };
      }

      // Handle 404 responses with code -200 as "not found" rather than errors
      if (!response.ok && !(response.status === 404 && result.code === -200)) {
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

function extractDataFromApiResults(apiResults: any): DiscoveredData {
  const allPeople = new Set<string>();
  const allPlaces = new Set<string>();

  // Add original queries
  apiResults.people_queries?.forEach((query: any) => {
    if (query.query) {
      allPeople.add(query.query);
    }
  });

  apiResults.places_queries?.forEach((query: any) => {
    if (query.query) {
      allPlaces.add(query.query);
    }
  });

  // Add names discovered from places API responses
  apiResults.places_queries?.forEach((query: any) => {
    if (query.result?.message && query.result.code === 0) {
      const names = query.result.message.split(" ");
      names.forEach((name: string) => {
        if (name.trim()) {
          let cleanName = removeDiacritics(name.trim()).toUpperCase();
          // Apply name corrections
          if (cleanName === "ALEKSANDR") cleanName = "ALEKSANDER";
          allPeople.add(cleanName);
        }
      });
    }
  });

  // Add places discovered from people API responses
  apiResults.people_queries?.forEach((query: any) => {
    if (
      query.result?.message &&
      query.result.code === 0 &&
      query.result.message !== "[**RESTRICTED DATA**]"
    ) {
      const places = query.result.message.split(" ");
      places.forEach((place: string) => {
        if (place.trim()) {
          let cleanPlace = removeDiacritics(place.trim()).toUpperCase();
          // Apply place corrections
          if (cleanPlace === "WARSAWA") cleanPlace = "WARSZAWA";
          allPlaces.add(cleanPlace);
        }
      });
    }
  });

  return {
    people: Array.from(allPeople).sort(),
    places: Array.from(allPlaces).sort(),
  };
}

export async function updateDatasets(personalApiKey: string): Promise<void> {
  try {
    console.log("\n📊 Starting iterative discovery process...");

    const client = new ApiClient(personalApiKey);
    const resultsDir = path.join(__dirname, "results");

    // Read the initial API query results
    const apiResultsPath = path.join(resultsDir, "api-query-results.json");
    let apiResults = JSON.parse(readFileSync(apiResultsPath, "utf-8"));

    let iteration = 1;
    let foundNewData = true;

    while (foundNewData) {
      console.log(`\n🔄 ITERATION ${iteration}:`);
      console.log("=".repeat(50));

      // Extract current dataset
      const currentData = extractDataFromApiResults(apiResults);

      console.log(
        `📊 Current dataset: ${currentData.people.length} people, ${currentData.places.length} places`
      );

      // Find what we haven't queried yet
      const queriedPeople = new Set(
        apiResults.people_queries?.map((q: any) => q.query) || []
      );
      const queriedPlaces = new Set(
        apiResults.places_queries?.map((q: any) => q.query) || []
      );

      const newPeople = currentData.people.filter(
        (person) => !queriedPeople.has(person)
      );
      const newPlaces = currentData.places.filter(
        (place) => !queriedPlaces.has(place)
      );

      console.log(
        `🆕 New to query: ${newPeople.length} people, ${newPlaces.length} places`
      );

      if (newPeople.length === 0 && newPlaces.length === 0) {
        console.log("✅ No new data to query - discovery complete!");
        foundNewData = false;
        break;
      }

      // Initialize query arrays for this iteration if they don't exist
      if (!apiResults.people_queries) apiResults.people_queries = [];
      if (!apiResults.places_queries) apiResults.places_queries = [];

      // Query new people
      if (newPeople.length > 0) {
        console.log(`\n👥 Querying ${newPeople.length} new people:`);
        for (const person of newPeople) {
          console.log(`   🔍 ${person}`);
          try {
            const result = await client.searchPeople(person);
            const queryResult = {
              query: person,
              timestamp: new Date().toISOString(),
              iteration: iteration,
              result: result,
            };
            apiResults.people_queries.push(queryResult);

            console.log(
              `      ${result.code === 0 ? "✅ Found" : "❌ Not Found"}`
            );
            if (result.message && result.message !== "[**RESTRICTED DATA**]") {
              console.log(`      Data: ${result.message}`);
            }
          } catch (error) {
            console.error(`      Error: ${error}`);
            apiResults.people_queries.push({
              query: person,
              timestamp: new Date().toISOString(),
              iteration: iteration,
              error: error instanceof Error ? error.message : "Unknown error",
            });
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }

      // Query new places
      if (newPlaces.length > 0) {
        console.log(`\n🏙️  Querying ${newPlaces.length} new places:`);
        for (const place of newPlaces) {
          console.log(`   🔍 ${place}`);
          try {
            const result = await client.searchPlaces(place);
            const queryResult = {
              query: place,
              timestamp: new Date().toISOString(),
              iteration: iteration,
              result: result,
            };
            apiResults.places_queries.push(queryResult);

            console.log(
              `      ${result.code === 0 ? "✅ Found" : result.code === -200 ? "❌ Not Found" : "⚠️  Unknown"}`
            );
            if (result.message) {
              console.log(`      Data: ${result.message}`);
            }
          } catch (error) {
            console.error(`      Error: ${error}`);
            apiResults.places_queries.push({
              query: place,
              timestamp: new Date().toISOString(),
              iteration: iteration,
              error: error instanceof Error ? error.message : "Unknown error",
            });
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }

      // Save updated API results after each iteration
      writeFileSync(apiResultsPath, JSON.stringify(apiResults, null, 2));

      iteration++;

      // Safety check to prevent infinite loops
      if (iteration > 10) {
        console.log("⚠️  Maximum iterations reached - stopping discovery");
        break;
      }
    }

    // Final data extraction and saving
    const finalData = extractDataFromApiResults(apiResults);

    console.log("\n✅ FINAL COMPLETE DATASET:");
    console.log("=".repeat(60));

    console.log("\n👥 ALL PEOPLE NAMES:");
    finalData.people.forEach((person, index) => {
      console.log(`${index + 1}. ${person}`);
    });

    console.log("\n🏙️  ALL PLACES:");
    finalData.places.forEach((place, index) => {
      console.log(`${index + 1}. ${place}`);
    });

    // Update the dataset files
    const peopleFilePath = path.join(resultsDir, "people-dataset.json");
    const placesFilePath = path.join(resultsDir, "places-dataset.json");

    writeFileSync(peopleFilePath, JSON.stringify(finalData.people, null, 2));
    writeFileSync(placesFilePath, JSON.stringify(finalData.places, null, 2));

    console.log("\n💾 FINAL DATASETS SAVED:");
    console.log(`   - ${peopleFilePath} (${finalData.people.length} names)`);
    console.log(`   - ${placesFilePath} (${finalData.places.length} places)`);

    // Create a complete discovery summary
    const discoverySummary = {
      discovery_timestamp: new Date().toISOString(),
      total_iterations: iteration - 1,
      total_people: finalData.people.length,
      total_places: finalData.places.length,
      people: finalData.people,
      places: finalData.places,
      source: "Extracted from barbara.txt and iterative API cross-references",
    };

    const summaryFilePath = path.join(
      resultsDir,
      "complete-discovery-summary.json"
    );
    writeFileSync(summaryFilePath, JSON.stringify(discoverySummary, null, 2));
    console.log(`   - ${summaryFilePath} (complete summary)`);

    console.log("\n🎯 ITERATIVE DISCOVERY COMPLETE!");
    console.log(
      `Found ${finalData.people.length} unique people and ${finalData.places.length} unique places across ${iteration - 1} iterations`
    );
  } catch (error) {
    console.error("❌ Error in iterative discovery:", error);
  }
}
