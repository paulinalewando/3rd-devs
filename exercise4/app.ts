import express from "express";
import * as fs from "fs";
import * as path from "path";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { OpenAIService } from "./OpenAIService";

const app = express();
app.use(express.json());

const port = process.env.PORT || 3000;

// Read the meta prompt file
const metaPromptPath = path.join(__dirname, "AI_devs-3-meta-prompt.md");
const metaPrompt = fs.readFileSync(metaPromptPath, "utf-8");

const openAIService = new OpenAIService();

app.post("/api/chat", async (req, res) => {
  try {
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res
        .status(400)
        .json({ error: "messages array is required and must not be empty" });
    }

    const systemMessage: ChatCompletionMessageParam = {
      role: "system",
      content: metaPrompt,
    };

    const apiMessages: ChatCompletionMessageParam[] = [
      systemMessage,
      ...messages,
    ];

    const response = await openAIService.completion(apiMessages);

    if ("choices" in response) {
      const answer =
        response.choices[0]?.message?.content?.trim() || "No answer provided";
      return res.json({ response: answer });
    } else {
      throw new Error("Invalid response format from OpenAI");
    }
  } catch (error) {
    console.error("Error in prompt-engineering endpoint:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
