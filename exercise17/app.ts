import * as fs from "fs";
import * as path from "path";
import { OpenAIService } from "./OpenAIService";

interface TrainingExample {
  messages: {
    role: string;
    content: string;
  }[];
}

interface VerificationResult {
  id: string;
  input: string;
  prediction: string;
  confidence?: number;
}

/**
 * Prepares a .jsonl file for fine-tuning a model
 * Reads data from correct.txt (answer "1") and incorect.txt (answer "0")
 */
function prepareFineTuningData(): void {
  const labDataPath = path.join(__dirname, "lab_data");
  const correctFilePath = path.join(labDataPath, "correct.txt");
  const incorrectFilePath = path.join(labDataPath, "incorect.txt");
  const outputPath = path.join(__dirname, "training_data.jsonl");

  try {
    // Read the files
    const correctData = fs.readFileSync(correctFilePath, "utf-8");
    const incorrectData = fs.readFileSync(incorrectFilePath, "utf-8");

    // Split into lines and filter out empty lines
    const correctLines = correctData
      .split("\n")
      .filter((line) => line.trim() !== "");
    const incorrectLines = incorrectData
      .split("\n")
      .filter((line) => line.trim() !== "");

    console.log(
      `Processing ${correctLines.length} correct examples and ${incorrectLines.length} incorrect examples...`
    );

    // Prepare training examples array
    const trainingExamples: TrainingExample[] = [];

    // Process correct examples (answer "1")
    correctLines.forEach((line) => {
      const example: TrainingExample = {
        messages: [
          {
            role: "system",
            content: "validate data",
          },
          {
            role: "user",
            content: line.trim(),
          },
          {
            role: "assistant",
            content: "1",
          },
        ],
      };
      trainingExamples.push(example);
    });

    // Process incorrect examples (answer "0")
    incorrectLines.forEach((line) => {
      const example: TrainingExample = {
        messages: [
          {
            role: "system",
            content: "validate data",
          },
          {
            role: "user",
            content: line.trim(),
          },
          {
            role: "assistant",
            content: "0",
          },
        ],
      };
      trainingExamples.push(example);
    });

    // Shuffle the training examples to mix correct and incorrect examples
    for (let i = trainingExamples.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [trainingExamples[i], trainingExamples[j]] = [
        trainingExamples[j],
        trainingExamples[i],
      ];
    }

    // Convert to JSONL format (one JSON object per line)
    const jsonlContent = trainingExamples
      .map((example) => JSON.stringify(example))
      .join("\n");

    // Write to output file
    fs.writeFileSync(outputPath, jsonlContent, "utf-8");

    console.log(
      `✅ Successfully created training_data.jsonl with ${trainingExamples.length} examples`
    );
    console.log(`📁 File saved to: ${outputPath}`);
    console.log(
      `📊 Breakdown: ${correctLines.length} positive examples, ${incorrectLines.length} negative examples`
    );
  } catch (error) {
    console.error("❌ Error preparing fine-tuning data:", error);
    process.exit(1);
  }
}

/**
 * Alternative function that creates a simpler format for classification tasks
 */
function prepareSimpleClassificationData(): void {
  const labDataPath = path.join(__dirname, "lab_data");
  const correctFilePath = path.join(labDataPath, "correct.txt");
  const incorrectFilePath = path.join(labDataPath, "incorect.txt");
  const outputPath = path.join(__dirname, "classification_data.jsonl");

  try {
    // Read the files
    const correctData = fs.readFileSync(correctFilePath, "utf-8");
    const incorrectData = fs.readFileSync(incorrectFilePath, "utf-8");

    // Split into lines and filter out empty lines
    const correctLines = correctData
      .split("\n")
      .filter((line) => line.trim() !== "");
    const incorrectLines = incorrectData
      .split("\n")
      .filter((line) => line.trim() !== "");

    console.log(
      `Processing ${correctLines.length} correct examples and ${incorrectLines.length} incorrect examples...`
    );

    // Prepare training examples array
    const trainingExamples: any[] = [];

    // Process correct examples (answer "1")
    correctLines.forEach((line) => {
      trainingExamples.push({
        input: line.trim(),
        output: "1",
      });
    });

    // Process incorrect examples (answer "0")
    incorrectLines.forEach((line) => {
      trainingExamples.push({
        input: line.trim(),
        output: "0",
      });
    });

    // Shuffle the training examples
    for (let i = trainingExamples.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [trainingExamples[i], trainingExamples[j]] = [
        trainingExamples[j],
        trainingExamples[i],
      ];
    }

    // Convert to JSONL format
    const jsonlContent = trainingExamples
      .map((example) => JSON.stringify(example))
      .join("\n");

    // Write to output file
    fs.writeFileSync(outputPath, jsonlContent, "utf-8");

    console.log(
      `✅ Successfully created classification_data.jsonl with ${trainingExamples.length} examples`
    );
    console.log(`📁 File saved to: ${outputPath}`);
  } catch (error) {
    console.error("❌ Error preparing classification data:", error);
    process.exit(1);
  }
}

/**
 * Verifies test data using the fine-tuned model and sends correct examples to the report URL
 */
async function verifyWithFineTunedModel(): Promise<void> {
  const openaiService = new OpenAIService();
  const verifyFilePath = path.join(__dirname, "lab_data", "verify.txt");

  try {
    // Read the verify.txt file
    const verifyData = fs.readFileSync(verifyFilePath, "utf-8");
    const verifyLines = verifyData
      .split("\n")
      .filter((line) => line.trim() !== "");

    console.log(
      `🔍 Verifying ${verifyLines.length} examples with fine-tuned model...`
    );
    console.log("📋 Processing each example:\n");

    const results: VerificationResult[] = [];
    const correctExamples: string[] = [];

    // Process each verification example
    for (const line of verifyLines) {
      const [id, ...dataParts] = line.split("=");
      const input = dataParts.join("="); // In case there are multiple '=' in the data

      console.log(`🔸 ${id}: ${input}`);

      try {
        // Create the same format as training data
        const messages = [
          {
            role: "system" as const,
            content: "validate data",
          },
          {
            role: "user" as const,
            content: input.trim(),
          },
        ];

        // Get prediction from fine-tuned model
        const completion = await openaiService.completion(messages);

        if ("choices" in completion) {
          const prediction =
            completion.choices[0]?.message?.content?.trim() || "unknown";

          results.push({
            id: id.trim(),
            input: input.trim(),
            prediction: prediction,
          });

          console.log(`   ➜ Prediction: ${prediction}`);

          // Collect correct examples (prediction "1")
          if (prediction === "1") {
            correctExamples.push(id.trim());
            console.log(`   ✅ Marked as correct`);
          } else {
            console.log(`   ❌ Marked as incorrect`);
          }
        }
      } catch (error) {
        console.error(`   ❌ Error processing ${id}:`, error);
        results.push({
          id: id.trim(),
          input: input.trim(),
          prediction: "error",
        });
      }

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    console.log("\n📊 Verification Summary:");
    console.log(`✅ Total examples processed: ${results.length}`);
    console.log(
      `🎯 Correct examples (prediction "1"): ${correctExamples.length}`
    );
    console.log(`📝 Correct IDs: [${correctExamples.join(", ")}]`);

    // Show distribution of predictions
    const predictionCounts = results.reduce(
      (acc, result) => {
        acc[result.prediction] = (acc[result.prediction] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    console.log("\n🎯 Prediction Distribution:");
    Object.entries(predictionCounts).forEach(([prediction, count]) => {
      console.log(`   ${prediction}: ${count} examples`);
    });

    // Send results to the report URL
    await sendReport(correctExamples);
  } catch (error) {
    console.error("❌ Error during verification:", error);
    process.exit(1);
  }
}

/**
 * Sends the correct examples to the report URL
 */
async function sendReport(correctExamples: string[]): Promise<void> {
  const reportUrl = "https://c3ntrala.ag3nts.org/report";

  // You'll need to set your personal API key here
  const apiKey = process.env.PERSONAL_API_KEY || "YOUR_PERSONAL_API_KEY";

  const reportData = {
    task: "research",
    apikey: apiKey,
    answer: correctExamples,
  };

  console.log("\n📡 Sending report to central server...");
  console.log("📦 Report data:", JSON.stringify(reportData, null, 2));

  try {
    const response = await fetch(reportUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(reportData),
    });

    if (response.ok) {
      const responseText = await response.text();
      console.log("✅ Report sent successfully!");
      console.log("📋 Server response:", responseText);
    } else {
      console.error("❌ Failed to send report. Status:", response.status);
      console.error("📋 Response:", await response.text());
    }
  } catch (error) {
    console.error("❌ Error sending report:", error);
  }
}

// Main execution
const main = async () => {
  console.log("🚀 Running verification with fine-tuned model...\n");
  await verifyWithFineTunedModel();
};

main();
