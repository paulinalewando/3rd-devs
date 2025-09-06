import fs from "fs/promises";
import path from "path";

// Interfaces for different API responses
interface DatabaseApiRequest {
  task: string;
  apikey: string;
  query: string;
}

interface DatabaseApiResponse {
  reply?: any[];
  error?: string;
  message?: string;
}

interface PlacesApiRequest {
  apikey: string;
  query: string;
}

interface PlacesApiResponse {
  code?: number;
  reply?: any;
  message?: string;
}

interface GpsApiRequest {
  task: string;
  apikey: string;
  userID: number;
}

interface GpsApiResponse {
  lat?: number;
  lon?: number;
  error?: string;
}

interface Person {
  name: string;
  userID?: number;
  coordinates?: { lat: number; lon: number };
}

/**
 * GPS Tracking Agent - decides which APIs to call and when
 */
class GpsTrackingAgent {
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.PERSONAL_API_KEY || "";
  }

  /**
   * Main agent decision-making process
   */
  async execute(): Promise<Record<string, { lat: number; lon: number }>> {
    console.log("🤖 Starting GPS Tracking Agent...");

    // Step 1: Read the question to understand what we need to do
    const question = await this.readQuestion();
    console.log("📖 Question analyzed:", question.question);

    // Step 2: Get people who were waiting for Rafał in Lubawa or associated places
    console.log(
      "\n🔍 Step 1: Getting people from Lubawa and related places..."
    );
    const placesToCheck = ["LUBAWA", "LUBLIN", "GRUDZIADZ", "WARSZAWA"];
    let allPeople: string[] = [];

    for (const place of placesToCheck) {
      console.log(`Checking people in ${place}...`);
      const peopleInPlace = await this.getPeopleFromPlace(place);
      console.log(`👥 Found people in ${place}:`, peopleInPlace);
      allPeople = [...allPeople, ...peopleInPlace];
    }

    // Remove duplicates
    const uniquePeople = [...new Set(allPeople)];
    console.log("👥 All unique people found:", uniquePeople);

    // Step 3: Get user IDs for all people (except Barbara)
    console.log("\n🔍 Step 2: Getting user IDs from database...");
    const peopleWithIDs = await this.getUserIDs(uniquePeople);
    console.log("🆔 People with IDs:", peopleWithIDs);

    // Step 4: Get GPS coordinates for all people
    console.log("\n🔍 Step 3: Getting GPS coordinates...");
    const peopleWithCoordinates = await this.getGpsCoordinates(peopleWithIDs);
    console.log("📍 People with coordinates:", peopleWithCoordinates);

    // Step 5: Filter out Barbara (if present) and format response
    console.log("\n🔍 Step 4: Filtering and formatting results...");
    const finalAnswer = this.formatFinalAnswer(peopleWithCoordinates);
    console.log("✅ Final answer:", finalAnswer);

    return finalAnswer;
  }

  /**
   * Read the question from qps_question.json
   */
  async readQuestion(): Promise<{ question: string }> {
    try {
      const questionPath = path.join(__dirname, "qps_question.json");
      const content = await fs.readFile(questionPath, "utf-8");
      return JSON.parse(content);
    } catch (error) {
      console.error("❌ Error reading question file:", error);
      throw error;
    }
  }

  /**
   * Get people from a specific place using exercise14's /places API
   */
  async getPeopleFromPlace(placeName: string): Promise<string[]> {
    const requestBody: PlacesApiRequest = {
      apikey: this.apiKey,
      query: placeName,
    };

    try {
      console.log(`🔍 Querying /places for ${placeName}...`);
      const response = await fetch("https://c3ntrala.ag3nts.org/places", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      const result: PlacesApiResponse = await response.json();
      console.log(
        `📝 Response for ${placeName}:`,
        JSON.stringify(result, null, 2)
      );

      if (result.code === 0) {
        if (result.message) {
          // The message contains the people names separated by spaces
          const people = result.message
            .split(" ")
            .filter((name) => name.trim().length > 0);
          return people;
        } else if (result.reply) {
          // Extract people names from the reply
          const people = Array.isArray(result.reply)
            ? result.reply
            : [result.reply];
          return people.map((person: any) => {
            if (typeof person === "string") return person;
            if (typeof person === "object" && person.name) return person.name;
            return JSON.stringify(person);
          });
        }
      } else {
        console.log(
          `⚠️ API returned code ${result.code} for ${placeName}: ${result.message}`
        );
      }
      return [];
    } catch (error) {
      console.error(`❌ Error querying places API for ${placeName}:`, error);
      return [];
    }
  }

  /**
   * Get user IDs from exercise13's database API
   */
  async getUserIDs(people: string[]): Promise<Person[]> {
    const peopleWithIDs: Person[] = [];

    for (const personName of people) {
      // Skip Barbara as per requirements
      if (personName.toLowerCase().includes("barbara")) {
        console.log(`⚠️ Skipping Barbara as per requirements`);
        continue;
      }

      try {
        const query = `SELECT id FROM users WHERE username = '${personName}'`;
        const requestBody: DatabaseApiRequest = {
          task: "database",
          apikey: this.apiKey,
          query: query,
        };

        const response = await fetch("https://c3ntrala.ag3nts.org/apidb", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        });

        const result: DatabaseApiResponse = await response.json();

        if (result.reply && result.reply.length > 0) {
          const userID = parseInt(result.reply[0].id);
          peopleWithIDs.push({ name: personName, userID });
          console.log(`✅ Found ID ${userID} for ${personName}`);
        } else {
          console.log(`⚠️ No ID found for ${personName}`);
          peopleWithIDs.push({ name: personName }); // Keep without ID
        }
      } catch (error) {
        console.error(`❌ Error getting ID for ${personName}:`, error);
        peopleWithIDs.push({ name: personName }); // Keep without ID
      }

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    return peopleWithIDs;
  }

  /**
   * Get GPS coordinates for people with user IDs
   */
  async getGpsCoordinates(people: Person[]): Promise<Person[]> {
    const peopleWithCoordinates: Person[] = [];

    for (const person of people) {
      if (!person.userID) {
        console.log(`⚠️ Skipping ${person.name} - no user ID`);
        peopleWithCoordinates.push(person);
        continue;
      }

      try {
        const requestBody: GpsApiRequest = {
          task: "gps",
          apikey: this.apiKey,
          userID: person.userID,
        };

        console.log(
          `🔍 GPS request for ${person.name} (ID: ${person.userID}):`,
          JSON.stringify(requestBody, null, 2)
        );

        const response = await fetch("https://c3ntrala.ag3nts.org/gps", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        });

        const result: any = await response.json();
        console.log(
          `📍 GPS response for ${person.name}:`,
          JSON.stringify(result, null, 2)
        );

        if (
          result.code === 0 &&
          result.message &&
          result.message.lat !== undefined &&
          result.message.lon !== undefined
        ) {
          person.coordinates = {
            lat: result.message.lat,
            lon: result.message.lon,
          };
          console.log(
            `✅ Got coordinates for ${person.name}: ${result.message.lat}, ${result.message.lon}`
          );
        } else {
          console.log(`⚠️ No coordinates found for ${person.name}:`, result);
        }
      } catch (error) {
        console.error(
          `❌ Error getting coordinates for ${person.name}:`,
          error
        );
      }

      peopleWithCoordinates.push(person);

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    return peopleWithCoordinates;
  }

  /**
   * Format the final answer excluding Barbara
   */
  formatFinalAnswer(
    people: Person[]
  ): Record<string, { lat: number; lon: number }> {
    const answer: Record<string, { lat: number; lon: number }> = {};

    for (const person of people) {
      // Double-check: exclude Barbara
      if (person.name.toLowerCase().includes("barbara")) {
        console.log(`⚠️ Excluding Barbara from final answer`);
        continue;
      }

      if (person.coordinates) {
        answer[person.name] = person.coordinates;
      }
    }

    return answer;
  }
}

/**
 * Sends answers to Centrala and returns the parsed response as object plus ok flag.
 */
async function sendAnswersToCentrala(
  answer: Record<string, { lat: number; lon: number }>
): Promise<{ ok: boolean; hint?: string }> {
  const centralaUrl = "https://c3ntrala.ag3nts.org/report";
  const apiKey = process.env.PERSONAL_API_KEY;

  const payload = {
    task: "gps",
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
      console.log("📥 Response:", response);
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
  try {
    // Create and execute the GPS tracking agent
    const agent = new GpsTrackingAgent();
    const coordinates = await agent.execute();

    // Send the results to Centrala
    const result = await sendAnswersToCentrala(coordinates);

    if (result.ok) {
      console.log(result);
      console.log("🎉 Task completed successfully!");
    } else {
      console.log("❌ Task failed. Hint:", result.hint);
    }
  } catch (error) {
    console.error("❌ Main error:", error);
  }
}

main().catch((err) => {
  console.error("⚠️ Błąd główny:", err);
});
