import { FactExtractor } from "./extract-facts";
import { ReportProcessor } from "./process-reports";
import { KeywordGenerator } from "./generate-keywords";
import { promises as fs } from "fs";
import path from "path";

/**
 * Sends the report with answers to the API
 */
async function sendReport(documents: Record<string, string>): Promise<string> {
  const reportData = {
    task: "dokumenty",
    apikey: process.env.PERSONAL_API_KEY,
    answer: documents,
  };

  console.log("Sending report:", JSON.stringify(reportData, null, 2));

  try {
    const response = await fetch("https://c3ntrala.ag3nts.org/report", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(reportData),
    });

    const responseText = await response.text();
    console.log("API Response:", responseText);

    if (!response.ok) {
      throw new Error(
        `Failed to send report: ${response.status} ${response.statusText} - ${responseText}`
      );
    }

    return responseText;
  } catch (error) {
    console.error("Error sending report:", error);
    throw error;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  try {
    const factsFile = path.join(__dirname, "extracted-facts-detailed.json");
    const reportsFile = path.join(__dirname, "processed-reports.json");
    const keywordsFile = path.join(__dirname, "keywords-for-api.json");

    // Extract facts from all files in the facts folder (only if not already done)
    if (!(await fileExists(factsFile))) {
      console.log("Starting fact extraction...");
      const extractor = new FactExtractor();
      const results = await extractor.processAllFiles();

      console.log("Saving extracted facts...");
      await extractor.saveResults(results);

      console.log("Fact extraction completed successfully!");
      console.log(`Processed ${results.length} files`);
    } else {
      console.log("✓ Facts already extracted, skipping fact extraction...");
    }

    // Process reports and match with facts (only if not already done)
    if (!(await fileExists(reportsFile))) {
      console.log("\n" + "=".repeat(50));
      console.log("Starting report processing...");
      const reportProcessor = new ReportProcessor();
      const reportResults = await reportProcessor.processAllReports();

      console.log("Saving report processing results...");
      await reportProcessor.saveResults(reportResults);

      console.log("Report processing completed successfully!");
      console.log(`Processed ${reportResults.length} reports`);
    } else {
      console.log("✓ Reports already processed, skipping report processing...");
    }

    // Generate Polish keywords from processed data (only if not already done)
    console.log("\n" + "=".repeat(50));
    console.log("Starting Polish keyword generation...");
    const keywordGenerator = new KeywordGenerator();
    const keywordResults = await keywordGenerator.processAllReports();

    console.log("Saving keyword generation results...");
    await keywordGenerator.saveResults(keywordResults);

    console.log("Polish keyword generation completed successfully!");
    console.log(`Generated keywords for ${keywordResults.length} reports`);

    // Load and display the final keywords for API submission

    console.log("\n" + "=".repeat(50));
    console.log("FINAL KEYWORDS FOR API SUBMISSION:");
    const keywordsContent = await fs.readFile(keywordsFile, "utf-8");
    const keywords: Record<string, string> = JSON.parse(keywordsContent);

    // Convert to proper API format with .txt extensions
    const apiAnswer = Object.entries(keywords).reduce(
      (acc, [fileName, keywordList]) => {
        // Add .txt extension if not present
        const fullFileName = fileName.endsWith(".txt")
          ? fileName
          : fileName + ".txt";
        acc[fullFileName] = keywordList;
        return acc;
      },
      {} as Record<string, string>
    );

    Object.entries(apiAnswer).forEach(([fileName, keywordList]) => {
      console.log(`${fileName}: ${keywordList}`);
    });

    console.log(
      `\nReady to submit ${Object.keys(apiAnswer).length} keyword sets to API`
    );

    // Step 10: Send the report
    console.log("\nSending report...");
    const result = await sendReport(apiAnswer);

    console.log("Process completed successfully!");
    // ąconsole.log("Final result:", result);
  } catch (error) {
    console.error("Error in main process:", error);
    process.exit(1);
  }
}

// Execute the main function
main();
