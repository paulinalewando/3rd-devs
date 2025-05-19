import { OpenAIService } from "./OpenAIService";
import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  try {
    const audioDir = path.join(__dirname, "przesluchania");
    const files = fs.readdirSync(audioDir).filter((f) => f.endsWith(".m4a"));
    const openai = new OpenAIService();
    const transcriptions = [];

    // Step 1: Transcribe all files
    for (const file of files) {
      const filePath = path.join(audioDir, file);
      const audioBuffer = fs.readFileSync(filePath);
      try {
        const transcription = await openai.transcribe(audioBuffer, file);
        transcriptions.push({
          name: file.replace(".m4a", ""),
          text: transcription,
        });
      } catch (err) {
        console.error(`Error transcribing ${file}:`, err);
      }
    }

    console.log(transcriptions);

    // Step 2: Analyze transcriptions to find location
    const systemPrompt = `You are a detective in Kraków tasked with finding the exact street name where Professor Andrzej Maj's institute is located. The transcripts are in Polish, and there are several important clues to focus on:

1. Pay special attention to these key phrases in Polish:
   - "ulica" or "ul." (street)
   - References to "matematyk" (mathematician)
   - References to "komendant" (commander)
   - Any mentions of "instytut" (institute)
   - Any mentions of "Jagielloński" or variations

2. We know that:
   - The institute is in Kraków
   - It's connected to mathematics or computer science
   - There's a specific mention of a street named after a mathematician that intersects with a street named after a commander
   - It's likely near or part of the Jagiellonian University

Here are the interview transcripts to analyze:

${transcriptions.map((t) => `${t.name}'s Interview:\n"${t.text}"`).join("\n\n")}`;

    const userPrompt = `Analyze these Polish language transcripts carefully. Focus on the following key elements:

1. KEY PHRASE ANALYSIS
   - Look for the phrase "ulica od matematyka co wpada w komendanta"
   - This suggests an intersection between:
     * A street named after a mathematician
     * A street named after a military commander
   - This is likely our most important clue

2. LOCATION CONTEXT
   - Focus on mentions of:
     * Kraków's academic district
     * Jagiellonian University locations
     * Mathematics or Computer Science departments
     * Any specific street names or intersections

3. VERIFICATION
   - Cross-reference any street names mentioned
   - Verify if the streets actually intersect in Kraków
   - Consider the proximity to academic institutions

4. CONCLUSION
   - Identify the mathematician's street that intersects with a commander's street
   - Verify this location makes sense for a university institute
   - Provide the street name in its standard Polish form (with proper spelling)

Your response MUST:
1. Quote the specific Polish text that provides the key clues
2. Explain your interpretation of these clues
3. Show how you determined the exact street
4. End with "STREET_NAME:" followed by the correct street name in Polish (provide full street name without "ulica", "aleja" or "ul." prefix)

Remember: The key is understanding the Polish phrase about a mathematician's street intersecting with a commander's street. This is likely our most reliable clue for finding the exact location.`;

    const response = await openai.completion([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);

    if ("choices" in response) {
      const analysis = response.choices[0].message?.content;

      if (!analysis) {
        throw new Error("No content in OpenAI response");
      }

      console.log(analysis);

      // Extract street name from the analysis and clean it
      const streetMatch = analysis.match(/STREET_NAME:\s*([^\n]+)/);
      let streetName = streetMatch ? streetMatch[1].trim() : null;

      console.log("Street name:", streetName);

      if (streetName && process.env.API_KEY) {
        try {
          const result = await sendReport(streetName, process.env.API_KEY);
          console.log("Success:", result);
        } catch (error) {
          console.error("Error:", error);
        }
      } else {
        console.log("Could not process:", {
          streetName,
          hasApiKey: !!process.env.API_KEY,
        });
      }
    } else {
      throw new Error("Unexpected response format from OpenAI");
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

async function sendReport(streetName: string, apiKey: string): Promise<string> {
  const reportData = {
    task: "mp3",
    apikey: apiKey,
    answer: streetName,
  };

  const response = await fetch("https://c3ntrala.ag3nts.org/report", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(reportData),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to send report: ${response.status} ${response.statusText}`
    );
  }

  return response.text();
}

main();
