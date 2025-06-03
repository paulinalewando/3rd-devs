import { OpenAIService } from "./OpenAIService";
import fs from "fs/promises";
import path from "path";
import { PersonDescriptionService } from "./description";

interface PhotoAnalysis {
  _thinking: string;
  repair?: string;
  darken?: string;
  brighten?: string;
  qualityGood?: boolean;
}

interface ApiResponse {
  message: string;
  images?: string[];
}

interface ApiResponseAnalysis {
  _thinking: string;
  repairSuccessful: boolean;
  suggestsAlternative: boolean;
  extractedImageUrl?: string;
  nextAction?: "REPAIR" | "DARKEN" | "BRIGHTEN" | "STOP" | "CONTINUE";
  reasoning: string;
}

class PhotoFixingAgent {
  private openaiService: OpenAIService;
  private apiUrl = "https://c3ntrala.ag3nts.org/report";
  private savedImages: Set<string> = new Set();

  constructor() {
    this.openaiService = new OpenAIService();
  }

  async sendToApi(answer: string): Promise<ApiResponse> {
    try {
      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          task: "photos",
          apikey: process.env.PERSONAL_API_KEY,
          answer: answer,
        }),
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Error sending to API:", error);
      throw error;
    }
  }

  async downloadImage(imageUrl: string, fileName: string): Promise<string> {
    try {
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`Failed to download image: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const localPath = path.join("./exercise16/images", fileName);
      await fs.mkdir("./exercise16/images", { recursive: true });
      await fs.writeFile(localPath, buffer);

      console.log(`Downloaded image: ${fileName}`);
      return localPath;
    } catch (error) {
      console.error(`Error downloading image ${fileName}:`, error);
      throw error;
    }
  }

  async analyzeImageQuality(imagePath: string): Promise<PhotoAnalysis> {
    try {
      const image = await fs.readFile(imagePath);
      const base64Image = image.toString("base64");
      const fileName = path.basename(imagePath);

      const prompt = `Analyze this image for quality issues and determine if any repairs are needed. Consider:
- Overall image quality (blur, noise, artifacts)
- Brightness and exposure levels
- Color balance and saturation
- Any visible defects or distortions

Be STRICT about quality assessment. Only set qualityGood to true if the image is:
- Sharp and clear with no visible artifacts, corruption, or distortion
- Properly exposed (not too dark or too bright)
- Has good color balance and natural saturation
- Has no visible noise, blur, or pattern overlays
- Suitable for professional/commercial use

If there are ANY visible quality issues, defects, corruption, artifacts, or poor exposure, set qualityGood to false.

The filename for this image is: ${fileName}

Respond in JSON format:
{
  "_thinking": "Detailed explanation of your analysis, what quality issues you see (if any), and reasoning for your decision. Be very specific about any defects found.",
  "repair": "REPAIR ${fileName} (only if general quality issues like blur, noise, artifacts, corruption)",
  "darken": "DARKEN ${fileName} (only if image is too bright/overexposed)", 
  "brighten": "BRIGHTEN ${fileName} (only if image is too dark/underexposed)",
  "qualityGood": boolean (true ONLY if image has NO quality issues and is professional grade)
}

Only include one repair action - the most important one needed. Use the exact filename: ${fileName}`;

      const response = await this.openaiService.completion({
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: { url: `data:image/png;base64,${base64Image}` },
              },
            ],
          },
        ],
        model: "gpt-4o",
        jsonMode: true,
        maxTokens: 2000,
      });

      if ("choices" in response) {
        const content = response.choices[0].message.content;
        if (content) {
          return JSON.parse(content) as PhotoAnalysis;
        }
      }

      throw new Error("No response from OpenAI");
    } catch (error) {
      console.error(`Error analyzing image ${imagePath}:`, error);
      throw error;
    }
  }

  async saveGoodQualityImage(imagePath: string): Promise<void> {
    const fileName = path.basename(imagePath);

    if (this.savedImages.has(fileName)) {
      console.log(`Image ${fileName} already saved`);
      return;
    }

    const savedPath = path.join("./exercise16/saved_images", fileName);
    await fs.mkdir("./exercise16/saved_images", { recursive: true });
    await fs.copyFile(imagePath, savedPath);

    this.savedImages.add(fileName);
    console.log(`✅ Saved high-quality image: ${fileName}`);
  }

  async extractImageUrlsFromText(responseText: string): Promise<string[]> {
    try {
      const prompt = `Extract all image URLs from the following text. The text may contain:
- Complete image URLs (like https://example.com/image.png)
- Base URLs with separate filenames that need to be combined
- Just filenames that need to be combined with a known base URL
- Various formats of image references

Text to analyze:
"${responseText}"

If you find complete URLs, return them as-is.
If you find filenames (like IMG_123.PNG) mentioned in the text, assume they should be prefixed with "https://centrala.ag3nts.org/dane/barbara/" to create complete URLs.

Examples:
- "IMG_559_FGR4.PNG" → "https://centrala.ag3nts.org/dane/barbara/IMG_559_FGR4.PNG"
- "https://example.com/folder/IMG_1.PNG" → "https://example.com/folder/IMG_1.PNG"

Respond only with a JSON array of complete URLs:`;

      const response = await this.openaiService.completion({
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        model: "gpt-4o",
        jsonMode: true,
        maxTokens: 1000,
      });

      if ("choices" in response) {
        const content = response.choices[0].message.content;
        console.log("  LLM Response:", content);
        if (content && content.trim() !== "null") {
          try {
            const urls = JSON.parse(content);
            console.log("  Parsed URLs:", urls);

            // Handle different response formats
            let extractedUrls: string[] = [];
            if (Array.isArray(urls)) {
              extractedUrls = urls;
            } else if (urls.urls && Array.isArray(urls.urls)) {
              extractedUrls = urls.urls;
            } else if (urls.result && Array.isArray(urls.result)) {
              extractedUrls = urls.result;
            } else if (typeof urls === "object") {
              // Try to find arrays in the object
              const values = Object.values(urls);
              for (const value of values) {
                if (Array.isArray(value)) {
                  extractedUrls = value;
                  break;
                } else if (
                  typeof value === "string" &&
                  value.includes("http")
                ) {
                  extractedUrls = [value];
                  break;
                }
              }

              // Also try to find URLs as keys
              const keys = Object.keys(urls);
              for (const key of keys) {
                if (key.includes("http")) {
                  extractedUrls = [key];
                  break;
                }
              }
            }

            const validUrls = extractedUrls.filter(
              (url) => typeof url === "string" && url.includes("http")
            );
            if (validUrls.length > 0) {
              return validUrls;
            }
          } catch (parseError) {
            console.log("  JSON parse failed, trying fallback...");
          }
        }
      }
    } catch (error) {
      console.error("Error extracting URLs with LLM:", error);
    }

    // Fallback regex extraction (runs when LLM fails or returns no URLs)
    console.log("  Falling back to regex extraction...");

    // First try complete URLs
    const completeUrlMatches = responseText.match(/https:\/\/[^\s]+\.PNG/gi);
    if (completeUrlMatches) {
      console.log("  Found complete URLs:", completeUrlMatches);
      return completeUrlMatches;
    }

    // Then try filenames and construct URLs
    const fileNameMatches = responseText.match(/IMG_[^\s,\.]+\.PNG/gi);
    if (fileNameMatches) {
      const constructedUrls = fileNameMatches.map(
        (fileName) => `https://centrala.ag3nts.org/dane/barbara/${fileName}`
      );
      console.log("  Constructed URLs from filenames:", constructedUrls);
      return constructedUrls;
    }

    // Finally try base URL + simple filenames
    const baseUrlMatch = responseText.match(/https:\/\/[^\s]+\//);
    const simpleFileMatches = responseText.match(/IMG_\d+\.PNG/gi);

    if (baseUrlMatch && simpleFileMatches) {
      const baseUrl = baseUrlMatch[0];
      const fallbackUrls = simpleFileMatches.map(
        (fileName) => baseUrl + fileName
      );
      console.log("  Fallback URLs:", fallbackUrls);
      return fallbackUrls;
    }

    return [];
  }

  async processImages(): Promise<void> {
    try {
      console.log("🚀 Starting photo fixing agent...");

      // Step 1: Start conversation with API
      console.log("📡 Sending START command to API...");
      const startResponse = await this.sendToApi("START");
      console.log("API Response:", startResponse.message);

      // Extract image URLs from the START response (this is just URL extraction, not analysis)
      let imageUrls: string[] = [];
      if (startResponse.images && startResponse.images.length > 0) {
        imageUrls = startResponse.images;
      } else if (startResponse.message) {
        console.log("🤖 Using AI to extract image URLs from response...");
        imageUrls = await this.extractImageUrlsFromText(startResponse.message);
      }

      if (imageUrls.length === 0) {
        throw new Error("No images received from API");
      }

      console.log(`📸 Received ${imageUrls.length} images`);
      console.log("URLs:", imageUrls);

      // Step 2: Download all images
      const imagePaths: string[] = [];
      for (let i = 0; i < imageUrls.length; i++) {
        const imageUrl = imageUrls[i];
        // Extract the original filename from the URL
        const urlParts = imageUrl.split("/");
        const originalFileName = urlParts[urlParts.length - 1];
        const localPath = await this.downloadImage(imageUrl, originalFileName);
        imagePaths.push(localPath);
      }

      // Step 3: Process each image until quality is good
      for (const imagePath of imagePaths) {
        await this.processImageUntilGood(imagePath);
      }

      console.log(
        `✅ All images processed! Saved ${this.savedImages.size} high-quality images.`
      );
    } catch (error) {
      console.error("Error in photo processing:", error);
      throw error;
    }
  }

  async processImageUntilGood(imagePath: string): Promise<void> {
    const fileName = path.basename(imagePath, path.extname(imagePath));
    let currentPath = imagePath;
    let attempts = 0;
    const maxAttempts = 5; // Prevent infinite loops
    const triedCommands: Set<string> = new Set(); // Track which repair commands we've tried

    console.log(`\n🔍 Processing ${fileName}...`);

    while (attempts < maxAttempts) {
      attempts++;
      console.log(`  Attempt ${attempts}: Analyzing image quality...`);

      const analysis = await this.analyzeImageQuality(currentPath);
      console.log(`  AI Analysis: ${analysis._thinking}`);

      if (analysis.qualityGood) {
        console.log(`  ✅ Image quality is good enough!`);
        await this.saveGoodQualityImage(currentPath);
        break;
      }

      // Determine which repair action to take based on AI analysis
      let repairCommand = "";
      const currentFileName = path.basename(currentPath);

      if (analysis.repair && analysis.repair.includes(currentFileName)) {
        repairCommand = analysis.repair;
      } else if (analysis.darken && analysis.darken.includes(currentFileName)) {
        repairCommand = analysis.darken;
      } else if (
        analysis.brighten &&
        analysis.brighten.includes(currentFileName)
      ) {
        repairCommand = analysis.brighten;
      }

      if (!repairCommand) {
        console.log(
          `  ⚠️ No repair action suggested, saving current version...`
        );
        await this.saveGoodQualityImage(currentPath);
        break;
      }

      console.log(`  🔧 Applying repair: ${repairCommand}`);
      triedCommands.add(repairCommand.split(" ")[0]); // Store just the command (REPAIR, DARKEN, BRIGHTEN)

      // Send repair command to API
      const repairResponse = await this.sendToApi(repairCommand);
      console.log(`  API Response: ${repairResponse.message}`);

      // Use LLM to analyze the API response and decide next action
      console.log(`  🤖 Analyzing API response with AI...`);
      const responseAnalysis = await this.analyzeApiResponse(
        repairResponse.message,
        currentFileName,
        triedCommands
      );

      console.log(`  🧠 AI Decision: ${responseAnalysis._thinking}`);
      console.log(
        `  📋 Next Action: ${responseAnalysis.nextAction} - ${responseAnalysis.reasoning}`
      );

      // Handle the decision
      if (
        responseAnalysis.repairSuccessful &&
        responseAnalysis.extractedImageUrl
      ) {
        // Successfully got a repaired image
        let imageUrl = responseAnalysis.extractedImageUrl;

        // If it's just a filename, construct the full URL
        if (!imageUrl.includes("http")) {
          imageUrl = `https://centrala.ag3nts.org/dane/barbara/${imageUrl}`;
        }

        try {
          const urlParts = imageUrl.split("/");
          const repairedFileName = urlParts[urlParts.length - 1];
          currentPath = await this.downloadImage(imageUrl, repairedFileName);
          console.log(`  📥 Downloaded repaired image: ${repairedFileName}`);
          continue; // Continue with the new image
        } catch (downloadError) {
          console.log(
            `  ⚠️ Failed to download repaired image, trying URL extraction...`
          );
          // Fallback to URL extraction
          const extractedUrls = await this.extractImageUrlsFromText(
            repairResponse.message
          );
          if (extractedUrls.length > 0) {
            const urlParts = extractedUrls[0].split("/");
            const repairedFileName = urlParts[urlParts.length - 1];
            currentPath = await this.downloadImage(
              extractedUrls[0],
              repairedFileName
            );
            console.log(
              `  📥 Downloaded repaired image (fallback): ${repairedFileName}`
            );
            continue;
          }
        }
      }

      // Handle suggestions for alternative approaches
      if (responseAnalysis.suggestsAlternative) {
        const alternativeCommand = this.getAlternativeRepairCommand(
          currentFileName,
          triedCommands
        );

        if (alternativeCommand && responseAnalysis.nextAction !== "STOP") {
          console.log(`  🔄 Trying alternative repair: ${alternativeCommand}`);
          triedCommands.add(alternativeCommand.split(" ")[0]);

          const altRepairResponse = await this.sendToApi(alternativeCommand);
          console.log(
            `  Alternative API Response: ${altRepairResponse.message}`
          );

          // Analyze the alternative response
          const altAnalysis = await this.analyzeApiResponse(
            altRepairResponse.message,
            currentFileName,
            triedCommands
          );

          if (altAnalysis.repairSuccessful && altAnalysis.extractedImageUrl) {
            let imageUrl = altAnalysis.extractedImageUrl;
            if (!imageUrl.includes("http")) {
              imageUrl = `https://centrala.ag3nts.org/dane/barbara/${imageUrl}`;
            }

            try {
              const urlParts = imageUrl.split("/");
              const repairedFileName = urlParts[urlParts.length - 1];
              currentPath = await this.downloadImage(
                imageUrl,
                repairedFileName
              );
              console.log(
                `  📥 Downloaded alternative repaired image: ${repairedFileName}`
              );
              continue;
            } catch (error) {
              console.log(`  ⚠️ Failed to download alternative image`);
            }
          }
        }
      }

      // If we get here, either no repair was successful or we should stop
      if (
        responseAnalysis.nextAction === "STOP" ||
        (triedCommands.size >= 3 && !responseAnalysis.repairSuccessful)
      ) {
        console.log(
          `  🛑 Stopping repairs based on AI decision or too many attempts`
        );
        await this.saveGoodQualityImage(currentPath);
        break;
      }

      // If no successful repair but should continue, save current version
      if (!responseAnalysis.repairSuccessful) {
        console.log(`  ⚠️ No successful repair, saving current version...`);
        await this.saveGoodQualityImage(currentPath);
        break;
      }
    }

    if (attempts >= maxAttempts) {
      console.log(
        `  ⚠️ Max attempts reached for ${fileName}, saving final version...`
      );
      await this.saveGoodQualityImage(currentPath);
    }
  }

  private getAlternativeRepairCommand(
    fileName: string,
    triedCommands: Set<string>
  ): string | null {
    const availableCommands = ["REPAIR", "DARKEN", "BRIGHTEN"];

    for (const command of availableCommands) {
      if (!triedCommands.has(command)) {
        return `${command} ${fileName}`;
      }
    }

    return null; // All commands have been tried
  }

  async analyzeApiResponse(
    apiResponse: string,
    currentFileName: string,
    triedCommands: Set<string>
  ): Promise<ApiResponseAnalysis> {
    try {
      const prompt = `Analyze this API response to understand what happened and decide the next action.

API Response: "${apiResponse}"
Current filename: ${currentFileName}
Already tried commands: ${Array.from(triedCommands).join(", ")}

The API can respond in Polish or English. Common patterns:
- Success with new image: "Proszę: IMG_123_ABC.PNG" or includes a new filename
- Success with URL: Contains https:// with image URL
- Suggests trying something else: "Spróbuj czegoś innego", "try something else", "może spróbuj", etc.
- Refusal/no sense: "nie ma sensu", "nie wygląda dobrze", "doesn't make sense"
- Positive feedback: "dobrze", "good", "mamy ją" (we got it)

Analyze the response and provide:
1. Whether the repair was successful (new image provided)
2. Whether it suggests trying a different approach
3. Extract any image filename or URL mentioned
4. Recommend next action based on context

Please respond with a JSON object in the following format:
{
  "_thinking": "Analysis of what the API response means and what happened",
  "repairSuccessful": boolean (true if new image was provided),
  "suggestsAlternative": boolean (true if API suggests trying different command),
  "extractedImageUrl": "extracted URL or filename if found, or null",
  "nextAction": "REPAIR|DARKEN|BRIGHTEN|STOP|CONTINUE (based on response and what's been tried)",
  "reasoning": "Why this next action was chosen"
}`;

      const response = await this.openaiService.completion({
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        model: "gpt-4o",
        jsonMode: true,
        maxTokens: 1500,
      });

      if ("choices" in response) {
        const content = response.choices[0].message.content;
        if (content) {
          return JSON.parse(content) as ApiResponseAnalysis;
        }
      }

      // Fallback analysis
      return {
        _thinking: "Failed to analyze response with LLM",
        repairSuccessful: false,
        suggestsAlternative: true,
        nextAction: "STOP",
        reasoning: "Could not analyze API response",
      };
    } catch (error) {
      console.error("Error analyzing API response:", error);
      return {
        _thinking: "Error during analysis",
        repairSuccessful: false,
        suggestsAlternative: false,
        nextAction: "STOP",
        reasoning: "Analysis failed",
      };
    }
  }
}

// Main execution
async function main() {
  try {
    if (!process.env.PERSONAL_API_KEY) {
      throw new Error("PERSONAL_API_KEY environment variable is required");
    }

    // const agent = new PhotoFixingAgent();
    // await agent.processImages();
    const personDescriptionService = new PersonDescriptionService();
    await personDescriptionService.processAllSavedImages();
  } catch (error) {
    console.error("Application error:", error);
    process.exit(1);
  }
}

// Run the agent
main();
