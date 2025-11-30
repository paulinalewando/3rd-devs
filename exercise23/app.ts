import { OpenAIService } from "./OpenAIService";

interface TaskResponse {
  task: string;
  data: any;
}

interface SignResponse {
  code: number;
  message: {
    timestamp: number;
    signature: string;
    challenges: string[];
  };
}

class Exercise23 {
  private openai: OpenAIService;
  private baseUrl = "https://rafal.ag3nts.org/b46c3";
  private password = "NONOMNISMORIAR";

  constructor() {
    this.openai = new OpenAIService();
  }

  async run() {
    try {
      console.log("🚀 Starting Exercise 23 - Speed optimized solution");
      const startTime = Date.now();

      // Step 1: Get access token
      console.log("📡 Getting access token...");
      const tokenResponse = await fetch(this.baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: this.password }),
      });

      const tokenData = await tokenResponse.json();
      console.log("📋 Token response:", JSON.stringify(tokenData, null, 2));
      const hash = tokenData.message; // Token is in message field
      console.log("✅ Got hash:", hash);

      // Step 2: Sign the token
      console.log("🔐 Signing token...");
      const signResponse = await fetch(this.baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sign: hash }),
      });

      const signData: SignResponse = await signResponse.json();
      console.log("📋 Sign response:", JSON.stringify(signData, null, 2));
      console.log("✅ Got signature and URLs");

      // Step 3: Fetch both URLs in parallel (critical for speed)
      console.log("⚡ Fetching both sources in parallel...");
      const [source0Response, source1Response] = await Promise.all([
        fetch(signData.message.challenges[0]),
        fetch(signData.message.challenges[1]),
      ]);

      const [task0Data, task1Data]: [TaskResponse, TaskResponse] =
        await Promise.all([source0Response.json(), source1Response.json()]);

      console.log("📋 Task 0:", task0Data.task);
      console.log("📋 Task 0 Data:", JSON.stringify(task0Data.data, null, 2));
      console.log("📋 Task 1:", task1Data.task);
      console.log("📋 Task 1 Data:", JSON.stringify(task1Data.data, null, 2));

      // Step 4: Process both tasks in parallel with optimized prompts
      console.log("🧠 Processing tasks in parallel...");
      const [answer0, answer1] = await Promise.all([
        this.processTask(task0Data),
        this.processTask(task1Data),
      ]);

      // Step 5: Merge results
      const mergedAnswer = {
        source0: answer0,
        source1: answer1,
      };

      // Step 6: Send final response
      console.log("📤 Sending final response...");
      const finalResponse = {
        apikey: process.env.PERSONAL_API_KEY,
        timestamp: signData.message.timestamp,
        signature: signData.message.signature,
        answer: mergedAnswer,
      };

      const result = await fetch(this.baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(finalResponse),
      });

      const resultData = await result.json();

      const totalTime = Date.now() - startTime;
      console.log(`⏱️ Total execution time: ${totalTime}ms`);
      console.log("🎯 Final result:", resultData);

      return resultData;
    } catch (error) {
      console.error("❌ Error:", error);
      throw error;
    }
  }

  private async processTask(taskData: TaskResponse): Promise<string> {
    const { task, data } = taskData;

    let prompt: string;
    let additionalContext = "";

    // Check if task requires external data source
    if (task.includes("Źródło wiedzy")) {
      const sourceUrl = task.match(/https:\/\/[^\s]+/)?.[0];
      if (sourceUrl) {
        console.log(`📖 Fetching external source: ${sourceUrl}`);
        try {
          const sourceResponse = await fetch(sourceUrl);
          additionalContext = await sourceResponse.text();
          console.log(
            `✅ Got external data (${additionalContext.length} chars)`
          );
        } catch (error) {
          console.error("❌ Failed to fetch external source:", error);
        }
      }
    }

    if (additionalContext) {
      prompt = `Answer these questions in Polish based on the provided context:

Questions: ${JSON.stringify(data)}

Context: ${additionalContext}

Provide direct, concise answers in Polish. Format as a simple list.`;
    } else {
      prompt = `Answer these questions in Polish:

Questions: ${JSON.stringify(data)}

Provide direct, concise answers in Polish. Format as a simple list.`;
    }

    const response = await this.openai.completion({
      messages: [{ role: "user", content: prompt }],
      model: "gpt-4o-mini", // Faster model
      maxTokens: 300, // Increased for multiple answers
    });

    if ("choices" in response) {
      const answer = response.choices[0].message.content?.trim() || "";
      console.log(`🤖 AI Response: ${answer}`);
      return answer;
    }

    return "";
  }
}

// Run the exercise
const exercise = new Exercise23();
exercise.run().catch(console.error);
