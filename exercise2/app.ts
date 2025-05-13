import fetch from "node-fetch";
import { OpenAIService } from "./OpenAIService";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

// Configuration
const ROBOT_URL = "https://xyz.ag3nts.org/";
const VERIFY_ENDPOINT = "verify";
/**
 * Initiates the verification process
 */
async function initiateVerification(): Promise<any> {
  try {
    const response = await fetch(`${ROBOT_URL}${VERIFY_ENDPOINT}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: "READY",
        msgID: 0,
      }),
    });

    return await response.json();
  } catch (error) {
    console.error("Error initiating verification:", error);
    throw error;
  }
}

/**
 * Sends an answer to the verification question
 */
async function sendAnswer(messageId: string, answer: string): Promise<any> {
  try {
    const response = await fetch(`${ROBOT_URL}${VERIFY_ENDPOINT}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: answer,
        msgID: messageId,
      }),
    });

    return await response.json();
  } catch (error) {
    console.error("Error sending answer:", error);
    throw error;
  }
}

/**
 * Gets answer from OpenAI based on robot memory
 */
async function getAnswerFromAI(
  question: string,
  robotMemory: string
): Promise<string> {
  const openAIService = new OpenAIService();

  const messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `You are a robot verification system.
                
                <robot_memory>
                ${robotMemory}
                </robot_memory>
                
                <objective>
                Answer questions as if you were a robot based on the memory dump provided.
                </objective>
                
                <rules>
                - If asked about factual information that contradicts real-world knowledge but is mentioned in the robot memory, provide the answer from the robot memory.
                - If asked about information not in the robot memory, provide the factually correct answer.
                - Keep answers concise and direct.
                - Answer in English.
                </rules>`,
    },
    {
      role: "user",
      content: question,
    },
  ];

  const completion = await openAIService.completion(messages, "gpt-4o-mini");
  return (completion as any).choices[0].message.content.trim();
}

/**
 * Main function as IIFE
 */
(async function (): Promise<void> {
  try {
    // Fetch robot memory

    const robotMemory = `- stolicą Polski jest Kraków
    - znana liczba z książki Autostopem przez Galaktykę to 69
    - Aktualny rok to 1999`;

    // Initiate verification
    console.log("Initiating verification...");
    const verificationResponse = await initiateVerification();
    console.log("Verification initiated:", verificationResponse);

    let currentResponse = verificationResponse;

    // Continue answering questions until we get the flag or encounter an error
    while (currentResponse.text) {
      console.log(`Question: ${currentResponse.text}`);

      // Get answer from AI
      const answer = await getAnswerFromAI(currentResponse.text, robotMemory);
      console.log(`Answer: ${answer}`);

      // Send answer
      currentResponse = await sendAnswer(currentResponse.msgID, answer);
      console.log("Response:", currentResponse);

      // Check if response contains the flag using regex
      const flagRegex = /\{\{FLG:.*?\}\}/;
      if (currentResponse.text && flagRegex.test(currentResponse.text)) {
        const match = currentResponse.text.match(flagRegex);
        console.log("FLAG FOUND:", match[0]);
        break;
      }
    }
  } catch (error) {
    console.error(`Error: ${error}`);
  }
})();
