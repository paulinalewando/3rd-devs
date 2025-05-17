import * as dotenv from "dotenv";
import { OpenAIService } from "./OpenAIService";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

// Load environment variables from .env file
dotenv.config();

async function censorPersonalData(text: string): Promise<string> {
  const openaiService = new OpenAIService();

  const messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content:
        "You are a data censoring assistant. Your task is to identify and replace personal data (like names, surnames, ages, addresses, phone numbers, etc.) with the word 'CENZURA'. Pay special attention to ages - any number that could be someone's age should be censored. Return only the censored text, with no explanations or additional content.",
    },
    {
      role: "user",
      content: `Please censor all personal data in this text, including ages, replacing it with the word 'CENZURA':\n\n${text}`,
    },
  ];

  try {
    const completion = await openaiService.completion(messages);
    if ("choices" in completion) {
      return completion.choices[0]?.message?.content || text;
    }
    return text;
  } catch (error) {
    console.error("Error during censoring:", error);
    return text;
  }
}

async function sendReport(censoredData: string, apiKey: string): Promise<void> {
  const reportData = {
    task: "CENZURA",
    apikey: apiKey,
    answer: censoredData,
  };

  try {
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

    const result = await response.text();
    console.log("Report sent successfully:", result);
  } catch (error) {
    console.error("Error sending report:", error);
    throw error;
  }
}

async function main() {
  const apiKey = process.env.PERSONAL_API_KEY;

  if (!apiKey) {
    throw new Error("PERSONAL_API_KEY is not set in environment variables");
  }

  try {
    const response = await fetch(
      `https://c3ntrala.ag3nts.org/data/${apiKey}/cenzura.txt`
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.text();
    console.log("Original data:", data);

    const censoredData = await censorPersonalData(data);
    console.log("Censored data:", censoredData);

    await sendReport(censoredData, apiKey);
  } catch (error) {
    console.error("Failed to process data:", error);
  }
}

main();
