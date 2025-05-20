import sharp from "sharp";
import { OpenAIService } from "./OpenAIService";
import { readFile } from "fs/promises";
import { join } from "path";
import type {
  ChatCompletionMessageParam,
  ChatCompletionContentPartImage,
  ChatCompletionContentPartText,
  ChatCompletion,
} from "openai/resources/chat/completions/index.mjs";
import { readdir } from "fs/promises";

const openAIService = new OpenAIService();

async function processImagesCollectively(): Promise<void> {
  const imageFolder = join(__dirname, "images");
  const files = await readdir(imageFolder);
  const pngFiles = files.filter((file) => file.endsWith(".png"));

  // Load all image files as base64
  const imagePromises = pngFiles.map(async (file) => {
    const filePath = join(imageFolder, file);
    const fileData = await readFile(filePath);
    return {
      file,
      base64Image: fileData.toString("base64"),
    };
  });

  const images = await Promise.all(imagePromises);

  // Create a message with all images
  const content: (
    | ChatCompletionContentPartImage
    | ChatCompletionContentPartText
  )[] = [];

  // Add introductory text
  content.push({
    type: "text",
    text: "Below are multiple map fragments. Analyze them together and determine which Polish city they depict. Focus especially on identifying street names and carefully observe how the streets are arranged (grid patterns, radial layouts, medieval irregular patterns, etc.). Be aware that ONE fragment is from a different city than the others. Important clue: the main city is known as 'miasto spichlerzy i twierdz' (a city of granaries and fortresses).",
  } as ChatCompletionContentPartText);

  // Add each image with its identifier
  images.forEach((image, index) => {
    content.push({
      type: "image_url",
      image_url: {
        url: `data:image/png;base64,${image.base64Image}`,
        detail: "high",
      },
    } as ChatCompletionContentPartImage);

    content.push({
      type: "text",
      text: `Fragment ${index + 1}: ${image.file}`,
    } as ChatCompletionContentPartText);
  });

  const messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `You are a helpful assistant specialized in analyzing map fragments from Polish cities.
Your task is to:
1. Analyze all provided map fragments together
2. Pay special attention to street layout patterns (grid system, radial, medieval irregular, etc.)
3. Identify specific street names visible in each fragment (this is critical)
4. Note the geometric arrangement of streets and their intersections
5. Identify which Polish city the majority of fragments are from
6. Determine which ONE fragment is from a different city
7. Look for distinguishing urban layout patterns and landmarks
8. VERIFY that the street names and landmarks you recognize truly exist in the specific city you identify

Work methodically:
1. First identify clearly visible street names and landmarks in each fragment
2. Analyze the pattern of how streets are arranged and intersect
3. Research if these streets/landmarks exist in a particular Polish city
4. Cross-reference features across fragments to determine which city most fragments represent
5. Identify which fragment has features inconsistent with that main city
6. Double-check your answer by verifying all identified locations actually exist in their respective cities

Format your answer as:
Fragment 1 (filename): 
- City: [CITY NAME]
- Recognized streets: [LIST OF STREET NAMES VISIBLE IN THIS FRAGMENT]
- Street layout pattern: [DESCRIPTION OF HOW STREETS ARE ARRANGED]
- Verification: [BRIEF EXPLANATION CONFIRMING STREETS EXIST IN THIS CITY]

Fragment 2 (filename):
- City: [CITY NAME]
- Recognized streets: [LIST OF STREET NAMES VISIBLE IN THIS FRAGMENT]
- Street layout pattern: [DESCRIPTION OF HOW STREETS ARE ARRANGED]
- Verification: [BRIEF EXPLANATION CONFIRMING STREETS EXIST IN THIS CITY]

And so on...`,
    },
    {
      role: "user",
      content: content,
    },
  ];

  const chatCompletion = (await openAIService.completion(
    messages,
    "gpt-4o",
    false,
    false,
    1500,
    0.2
  )) as ChatCompletion;

  console.log(chatCompletion.choices[0].message.content);
}

await processImagesCollectively();
