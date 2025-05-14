import fetch from "node-fetch";
import { OpenAIService } from "./OpenAIService";
import * as fs from "fs";
import * as path from "path";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

interface MathQuestion {
  question: string;
  answer: number;
  test?: {
    q: string;
    a: string | number;
  };
}

async function downloadJsonFile() {
  const url = `https://c3ntrala.ag3nts.org/data/${process.env.API_KEY}/json.txt`;
  const outputPath = path.join(__dirname, "data.json");

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `Failed to download: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.text();
    fs.writeFileSync(outputPath, data);
    return JSON.parse(data);
  } catch (error) {
    console.error("Error downloading file:", error);
    throw error;
  }
}

function fixIncorrectAnswers(jsonData: any): any {
  // Clone the object to avoid modifying the original
  const fixedData = JSON.parse(JSON.stringify(jsonData));

  if (Array.isArray(fixedData["test-data"])) {
    console.log(
      `Checking ${fixedData["test-data"].length} math problems for errors...`
    );

    let correctionCount = 0;
    fixedData["test-data"] = fixedData["test-data"].map(
      (item: MathQuestion) => {
        // Only process items with question property that contains a math expression
        if (item.question && typeof item.question === "string") {
          try {
            // Use eval to calculate the correct answer for the math expression
            const correctAnswer = eval(item.question);

            if (item.answer !== correctAnswer) {
              console.log(
                `Fixing: ${item.question} = ${correctAnswer} (was ${item.answer})`
              );
              correctionCount++;
              return { ...item, answer: correctAnswer };
            }
          } catch (error) {
            // If eval fails, keep the original item unchanged
            console.log(`Skipping non-evaluable expression: ${item.question}`);
          }
        }
        return item;
      }
    );

    console.log(`Fixed ${correctionCount} incorrect answers`);
  }

  return fixedData;
}

async function answerTestQuestions(jsonData: any): Promise<any> {
  const openAIService = new OpenAIService();
  const fixedData = JSON.parse(JSON.stringify(jsonData));

  if (Array.isArray(fixedData["test-data"])) {
    const questionsWithTests = fixedData["test-data"].filter(
      (item: MathQuestion) => item.test && item.test.q && item.test.a === "???"
    );

    console.log(
      `Found ${questionsWithTests.length} test questions that need answers`
    );

    for (const item of questionsWithTests) {
      if (item.test) {
        console.log(`Getting AI answer for: "${item.test.q}"`);

        const messages: ChatCompletionMessageParam[] = [
          {
            role: "system",
            content:
              "You are a helpful assistant that provides very concise answers. Answer the following question in the most direct, shortest way possible - just one world (year, city, etc).",
          },
          {
            role: "user",
            content: item.test.q,
          },
        ];

        try {
          const response = await openAIService.completion(messages);
          if ("choices" in response) {
            const answer =
              response.choices[0]?.message?.content?.trim() ||
              "No answer provided";
            console.log(`Answer: "${answer}"`);
            item.test.a = answer;
          }
        } catch (error) {
          console.error(`Error getting answer for "${item.test.q}":`, error);
          item.test.a = "Error getting answer";
        }
      }
    }
  }

  return fixedData;
}

function saveFixedData(fixedData: any) {
  const outputPath = path.join(__dirname, "fixed-data.json");
  fs.writeFileSync(outputPath, JSON.stringify(fixedData, null, 2));
  console.log(`Fixed data saved to ${outputPath}`);
}

async function sendReportToEndpoint(fixedData: any) {
  const url = "https://c3ntrala.ag3nts.org/report";

  // Extract the apikey from the fixed data or use the environment variable
  const apiKey = process.env.API_KEY || "";

  const payload = {
    task: "JSON",
    apikey: apiKey,
    answer: {
      apikey: apiKey,
      description:
        "This is simple calibration data used for testing purposes. Do not use it in production environment!",
      copyright: "Copyright (C) 2238 by BanAN Technologies Inc.",
      "test-data": fixedData["test-data"],
    },
  };

  console.log("Sending report to endpoint...");

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to send report: ${response.status} ${response.statusText}`
      );
    }

    const responseData = await response.json();
    console.log("Report sent successfully!");
    console.log("Response:", JSON.stringify(responseData, null, 2));
    return responseData;
  } catch (error) {
    console.error("Error sending report:", error);
    throw error;
  }
}

// Execute the data processing and reporting
async function processData() {
  try {
    const jsonData = await downloadJsonFile();
    console.log("JSON data loaded successfully");

    // Fix incorrect answers
    const fixedMathData = fixIncorrectAnswers(jsonData);

    // Answer test questions using OpenAI
    const completeData = await answerTestQuestions(fixedMathData);

    // Save the fixed data locally
    saveFixedData(completeData);

    // Send the report to the endpoint
    await sendReportToEndpoint(completeData);

    console.log("Data processing and reporting completed");
  } catch (err) {
    console.error("Failed to process JSON data:", err);
  }
}

processData();
