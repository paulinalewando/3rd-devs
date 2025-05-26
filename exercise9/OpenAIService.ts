import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { createByModelName } from "@microsoft/tiktokenizer";
import { readFile } from "fs/promises";
import { createReadStream } from "fs";

export class OpenAIService {
  private openai: OpenAI;
  private tokenizers: Map<
    string,
    Awaited<ReturnType<typeof createByModelName>>
  > = new Map();
  private readonly IM_START = "<|im_start|>";
  private readonly IM_END = "<|im_end|>";
  private readonly IM_SEP = "<|im_sep|>";

  constructor() {
    this.openai = new OpenAI();
  }

  private async getTokenizer(modelName: string) {
    if (!this.tokenizers.has(modelName)) {
      const specialTokens: ReadonlyMap<string, number> = new Map([
        [this.IM_START, 100264],
        [this.IM_END, 100265],
        [this.IM_SEP, 100266],
      ]);
      const tokenizer = await createByModelName(modelName, specialTokens);
      this.tokenizers.set(modelName, tokenizer);
    }
    return this.tokenizers.get(modelName)!;
  }

  async countTokens(
    messages: ChatCompletionMessageParam[],
    model: string = "gpt-4o"
  ): Promise<number> {
    const tokenizer = await this.getTokenizer(model);

    let formattedContent = "";
    messages.forEach((message) => {
      formattedContent += `${this.IM_START}${message.role}${this.IM_SEP}${message.content || ""}${this.IM_END}`;
    });
    formattedContent += `${this.IM_START}assistant${this.IM_SEP}`;

    const tokens = tokenizer.encode(formattedContent, [
      this.IM_START,
      this.IM_END,
      this.IM_SEP,
    ]);
    return tokens.length;
  }

  async completion(
    messages: ChatCompletionMessageParam[],
    model: string = "gpt-4o",
    stream: boolean = false,
    jsonMode: boolean = false,
    maxTokens: number = 4096
  ): Promise<
    | OpenAI.Chat.Completions.ChatCompletion
    | AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
  > {
    try {
      const chatCompletion = await this.openai.chat.completions.create({
        messages,
        model,
        ...(model !== "o1-mini" &&
          model !== "o1-preview" && {
            stream,
            max_tokens: maxTokens,
            response_format: jsonMode
              ? { type: "json_object" }
              : { type: "text" },
          }),
      });

      if (stream) {
        return chatCompletion as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
      } else {
        return chatCompletion as OpenAI.Chat.Completions.ChatCompletion;
      }
    } catch (error) {
      console.error("Error in OpenAI completion:", error);
      throw error;
    }
  }

  /**
   * Transcribes audio content from MP3 files using Whisper
   */
  async transcribeAudio(
    filePath: string,
    language: string = "pl"
  ): Promise<string> {
    try {
      const transcription = await this.openai.audio.transcriptions.create({
        file: createReadStream(filePath),
        model: "whisper-1",
        language: language,
      });
      return transcription.text;
    } catch (error) {
      console.error(`Error transcribing audio file ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Extracts text from images using GPT-4o vision capabilities
   */
  async extractTextFromImage(filePath: string): Promise<string> {
    try {
      const imageBuffer = await readFile(filePath);
      const base64Image = imageBuffer.toString("base64");

      const messages: ChatCompletionMessageParam[] = [
        {
          role: "system",
          content:
            "You are an OCR assistant. Extract ALL text from the image. If the text is in Polish, preserve it exactly as written. Return only the extracted text, nothing else.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract all text from this image:",
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${base64Image}`,
                detail: "high",
              },
            },
          ],
        },
      ];

      const response = (await this.completion(
        messages,
        "gpt-4o",
        false
      )) as OpenAI.Chat.Completions.ChatCompletion;
      return response.choices[0].message.content || "";
    } catch (error) {
      console.error(`Error extracting text from image ${filePath}:`, error);
      throw error;
    }
  }

  async calculateImageTokens(
    width: number,
    height: number,
    detail: "low" | "high"
  ): Promise<number> {
    let tokenCost = 0;

    if (detail === "low") {
      tokenCost += 85;
      return tokenCost;
    }

    const MAX_DIMENSION = 2048;
    const SCALE_SIZE = 768;

    // Resize to fit within MAX_DIMENSION x MAX_DIMENSION
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      const aspectRatio = width / height;
      if (aspectRatio > 1) {
        width = MAX_DIMENSION;
        height = Math.round(MAX_DIMENSION / aspectRatio);
      } else {
        height = MAX_DIMENSION;
        width = Math.round(MAX_DIMENSION * aspectRatio);
      }
    }

    // Scale the shortest side to SCALE_SIZE
    if (width >= height && height > SCALE_SIZE) {
      width = Math.round((SCALE_SIZE / height) * width);
      height = SCALE_SIZE;
    } else if (height > width && width > SCALE_SIZE) {
      height = Math.round((SCALE_SIZE / width) * height);
      width = SCALE_SIZE;
    }

    // Calculate the number of 512px squares
    const numSquares = Math.ceil(width / 512) * Math.ceil(height / 512);

    // Calculate the token cost
    tokenCost += numSquares * 170 + 85;

    return tokenCost;
  }
}
