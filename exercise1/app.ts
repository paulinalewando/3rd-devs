import fetch from "node-fetch";
import { URLSearchParams } from "url";
import { OpenAIService } from "./OpenAIService";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

// Configuration
const ROBOT_URL = "https://xyz.ag3nts.org/";
const ROBOT_USERNAME = "tester";
const ROBOT_PASSWORD = "574e112a";

/**
 * Main function
 */
async function main(): Promise<void> {
  try {
    // First, fetch the login page to get the question
    const loginResponse = await fetch(ROBOT_URL);
    const html = await loginResponse.text();

    // Extract the question
    const humanQuestionPattern =
      /<p\s+id="human-question"[^>]*>([\s\S]*?)<\/p>/i;
    const humanQuestionMatch = html.match(humanQuestionPattern);

    let answer = ""; // Default answer

    if (humanQuestionMatch) {
      const fullText = humanQuestionMatch[1].trim();
      const parts = fullText.split(/<br\s*\/?>/i);
      let question = "";

      if (parts.length > 1) {
        question = parts[1].replace(/<[^>]+>/g, "").trim();
      } else {
        question = fullText.replace(/<[^>]+>/g, "").trim();
        if (question === "Question:") {
          question = "";
        }
      }

      if (question) {
        // Get answer from OpenAI
        const openAIService = new OpenAIService();
        const messages: ChatCompletionMessageParam[] = [
          {
            role: "system",
            content: `You are a CAPTCHA Answer Provider.
                      <objective>
                      Provide only the numeric answer to security questions, with no explanation.
                      </objective>

                      <rules>
                      - Answer with ONLY the number, nothing else
                      - For historical questions, provide accurate year
                      - Translate Polish questions if needed
                      </rules>

                      <snippet_examples>
                      USER: Rok ataku na World Trade Center?
                      AI: 2001

                      USER: W którym roku człowiek wylądował na Księżycu?
                      AI: 1969
                      </snippet_examples>`,
          },
          {
            role: "user",
            content: question,
          },
        ];

        const completion = await openAIService.completion(
          messages,
          "gpt-4o-mini"
        );
        answer = (completion as any).choices[0].message.content.trim();
      }
    }

    if (!answer) {
      // Fallback to a default answer if OpenAI didn't provide one
      answer = "2001";
    }

    // Login to the robot system
    const params = new URLSearchParams();
    params.append("username", ROBOT_USERNAME);
    params.append("password", ROBOT_PASSWORD);
    params.append("answer", answer);

    const response = await fetch(ROBOT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
      redirect: "follow",
    });

    console.log(`Response URL: ${response.url}`);
  } catch (e) {
    console.error(`Error: ${e}`);
  }
}

// Run the main function
main();
