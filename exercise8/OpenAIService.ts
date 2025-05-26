import OpenAI from "openai";

export class OpenAIService {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI();
  }

  async generate(
    prompt: string,
    size: "1024x1024" | "1792x1024" | "1024x1792" = "1024x1024"
  ): Promise<string> {
    const response = await this.openai.images.generate({
      model: "dall-e-3",
      prompt,
      n: 1,
      size,
      response_format: "url",
      quality: "standard",
    });

    if (!response.data || response.data.length === 0 || !response.data[0].url) {
      throw new Error("Failed to generate image: No URL returned");
    }

    return response.data[0].url;
  }
}
