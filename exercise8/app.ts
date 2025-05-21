import { OpenAIService } from "./OpenAIService";

const openaiService = new OpenAIService();
const API_KEY = process.env.API_KEY as string;

if (!API_KEY) {
  console.error("API_KEY is required in .env file");
  process.exit(1);
}

async function main() {
  try {
    const robotDescription = await fetchRobotDescription(API_KEY);
    console.log("Robot description:", robotDescription);

    const imageUrl = await openaiService.generate(robotDescription);
    console.log("Generated image URL:", imageUrl);

    const reportResponse = await sendReport(imageUrl, API_KEY);
    console.log("Report response:", reportResponse);
  } catch (error) {
    console.error("Error in main process:", error);
  }
}

async function fetchRobotDescription(apiKey: string): Promise<string> {
  const response = await fetch(
    `https://c3ntrala.ag3nts.org/data/${apiKey}/robotid.json`
  );

  if (!response.ok) {
    throw new Error(
      `Failed to fetch robot description: ${response.status} ${response.statusText}`
    );
  }

  const data = await response.json();
  return data.description;
}

async function sendReport(url: string, apiKey: string): Promise<string> {
  const reportData = {
    task: "robotid",
    apikey: apiKey,
    answer: url,
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
