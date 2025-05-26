import type {
  ChatCompletion,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import { OpenAIService } from "./OpenAIService";
import { readFile, writeFile, readdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import * as dotenv from "dotenv";

// Load environment variables from .env file in parent directory
dotenv.config({ path: join(__dirname, "../.env") });

const openaiService = new OpenAIService();

interface FileAnalysis {
  filename: string;
  type: "txt" | "png" | "mp3";
  extractedContent: string;
  category: "people" | "hardware" | "none";
  processed: boolean;
}

interface AnalysisCache {
  [filename: string]: FileAnalysis;
}

/**
 * Transcribes audio content from MP3 files using Whisper
 */
async function transcribeAudio(filePath: string): Promise<string> {
  try {
    return await openaiService.transcribeAudio(filePath, "pl");
  } catch (error) {
    console.error(`Error transcribing audio file ${filePath}:`, error);
    return "";
  }
}

/**
 * Extracts text from images using GPT-4o vision capabilities
 */
async function extractTextFromImage(filePath: string): Promise<string> {
  try {
    return await openaiService.extractTextFromImage(filePath);
  } catch (error) {
    console.error(`Error extracting text from image ${filePath}:`, error);
    return "";
  }
}

/**
 * Categorizes content into people, hardware, or none
 */
async function categorizeContent(
  content: string,
  filename: string
): Promise<"people" | "hardware" | "none"> {
  const categorizationMessage: ChatCompletionMessageParam = {
    role: "system",
    content: `You are analyzing security patrol reports. Categorize the following text into one of these categories:

1. "people" - ONLY if the text contains information about:
   - Captured, detained, or arrested individuals
   - People found, identified, or processed during security operations
   - Unauthorized persons discovered on patrol
   - Specific individuals mentioned by name in a security context (biometric scans, fingerprint analysis, identification)
   - Evidence or traces of unauthorized human presence (footprints, personal items, etc.)
   
   Do NOT categorize as "people" if the text only mentions:
   - Team members or internal staff discussions
   - General references to humans without security implications
   - Casual conversations about food, logistics, or team management

2. "hardware" - ONLY if the text contains information about:
   - Hardware malfunctions, failures, or technical issues
   - Equipment problems or repairs
   - Broken or damaged physical equipment (NOT software issues)
   - Mechanical component failures

3. "none" - If the text doesn't clearly fit into either category above, including:
   - Routine patrol reports with no incidents
   - Software updates or AI algorithm improvements
   - Team discussions or administrative matters
   - Animal sightings or false alarms

Be very strict with the "people" category - only use it for actual security incidents involving unauthorized individuals.

Respond with ONLY one word: "people", "hardware", or "none".`,
  };

  const userMessage: ChatCompletionMessageParam = {
    role: "user",
    content: `File: ${filename}\nContent: ${content}`,
  };

  try {
    const response = (await openaiService.completion(
      [categorizationMessage, userMessage],
      "gpt-4o",
      false
    )) as ChatCompletion;

    const result = response.choices[0].message.content?.trim().toLowerCase();
    if (result === "people" || result === "hardware" || result === "none") {
      return result;
    }
    return "none";
  } catch (error) {
    console.error(`Error categorizing content for ${filename}:`, error);
    return "none";
  }
}

/**
 * Loads analysis cache from file
 */
async function loadAnalysisCache(): Promise<AnalysisCache> {
  const cacheFile = join(__dirname, "analysis_cache.json");
  try {
    if (existsSync(cacheFile)) {
      const cacheData = await readFile(cacheFile, "utf-8");
      return JSON.parse(cacheData);
    }
  } catch (error) {
    console.log(
      "No existing cache found or error reading cache, starting fresh."
    );
  }
  return {};
}

/**
 * Saves analysis cache to file
 */
async function saveAnalysisCache(cache: AnalysisCache): Promise<void> {
  const cacheFile = join(__dirname, "analysis_cache.json");
  await writeFile(cacheFile, JSON.stringify(cache, null, 2));
}

/**
 * Processes a single file and extracts its content
 */
async function processFile(
  filePath: string,
  filename: string,
  cache: AnalysisCache
): Promise<FileAnalysis> {
  // Check if already processed
  if (cache[filename] && cache[filename].processed) {
    console.log(`Using cached result for ${filename}`);
    return cache[filename];
  }

  const extension = filename.split(".").pop()?.toLowerCase();
  let extractedContent = "";
  let fileType: "txt" | "png" | "mp3";

  console.log(`Processing ${filename}...`);

  switch (extension) {
    case "txt":
      fileType = "txt";
      extractedContent = await readFile(filePath, "utf-8");
      break;

    case "png":
      fileType = "png";
      extractedContent = await extractTextFromImage(filePath);
      break;

    case "mp3":
      fileType = "mp3";
      extractedContent = await transcribeAudio(filePath);
      break;

    default:
      throw new Error(`Unsupported file type: ${extension}`);
  }

  // Categorize the content
  const category = await categorizeContent(extractedContent, filename);

  const analysis: FileAnalysis = {
    filename,
    type: fileType,
    extractedContent,
    category,
    processed: true,
  };

  // Update cache
  cache[filename] = analysis;
  await saveAnalysisCache(cache);

  return analysis;
}

/**
 * Main function to analyze all files and categorize them
 */
async function analyzeFiles(): Promise<void> {
  const filesDir = join(__dirname, "files");
  const cache = await loadAnalysisCache();

  try {
    const files = await readdir(filesDir);
    const supportedFiles = files.filter(
      (file) =>
        file.endsWith(".txt") || file.endsWith(".png") || file.endsWith(".mp3")
    );

    console.log(`Found ${supportedFiles.length} files to analyze...`);

    const analyses: FileAnalysis[] = [];

    // Process each file
    for (const filename of supportedFiles) {
      const filePath = join(filesDir, filename);
      try {
        const analysis = await processFile(filePath, filename, cache);
        analyses.push(analysis);

        console.log(`${filename}: ${analysis.category} (${analysis.type})`);
        if (analysis.extractedContent.length > 100) {
          console.log(
            `  Content preview: ${analysis.extractedContent.substring(0, 100)}...`
          );
        } else {
          console.log(`  Content: ${analysis.extractedContent}`);
        }
      } catch (error) {
        console.error(`Error processing ${filename}:`, error);
      }
    }

    // Categorize files
    const peopleFiles = analyses
      .filter((a) => a.category === "people")
      .map((a) => a.filename);

    const hardwareFiles = analyses
      .filter((a) => a.category === "hardware")
      .map((a) => a.filename);

    console.log("\n=== CATEGORIZATION RESULTS ===");
    console.log(`People files (${peopleFiles.length}):`, peopleFiles);
    console.log(`Hardware files (${hardwareFiles.length}):`, hardwareFiles);

    const noneFiles = analyses
      .filter((a) => a.category === "none")
      .map((a) => a.filename);
    console.log(`Other files (${noneFiles.length}):`, noneFiles);

    // Save final results
    const results = {
      people: peopleFiles,
      hardware: hardwareFiles,
      other: noneFiles,
      totalProcessed: analyses.length,
      timestamp: new Date().toISOString(),
    };

    await writeFile(
      join(__dirname, "categorization_results.json"),
      JSON.stringify(results, null, 2)
    );

    console.log("\nResults saved to categorization_results.json");

    await sendReport(peopleFiles, hardwareFiles);
  } catch (error) {
    console.error("Error in main analysis:", error);
  }
}

async function sendReport(
  peopleFiles: string[],
  hardwareFiles: string[]
): Promise<string> {
  const reportData = {
    task: "kategorie",
    apikey: process.env.PERSONAL_API_KEY,
    answer: {
      people: [...peopleFiles],
      hardware: [...hardwareFiles],
    },
  };
  console.log(reportData);
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
}

(() => {
  analyzeFiles().catch(console.error);
})();
