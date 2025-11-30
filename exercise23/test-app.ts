interface TaskResponse {
  task: string;
  data: any;
}

interface SignResponse {
  timestamp: string;
  signature: string;
  source0: string;
  source1: string;
}

class Exercise23Test {
  private baseUrl = "https://rafal.ag3nts.org/b46c3";
  private password = "NONOMNISMORIAR";

  async run() {
    try {
      console.log("🚀 Starting Exercise 23 - Speed optimized solution (TEST MODE)");
      const startTime = Date.now();

      // Step 1: Get access token
      console.log("📡 Getting access token...");
      const tokenResponse = await fetch(this.baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: this.password })
      });
      
      const tokenData = await tokenResponse.json();
      const hash = tokenData.hash;
      console.log("✅ Got hash:", hash);

      // Step 2: Sign the token
      console.log("🔐 Signing token...");
      const signResponse = await fetch(this.baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sign: hash })
      });

      const signData: SignResponse = await signResponse.json();
      console.log("✅ Got signature and URLs");
      console.log("📍 Source 0:", signData.source0);
      console.log("📍 Source 1:", signData.source1);

      // Step 3: Fetch both URLs in parallel (critical for speed)
      console.log("⚡ Fetching both sources in parallel...");
      const [source0Response, source1Response] = await Promise.all([
        fetch(signData.source0),
        fetch(signData.source1)
      ]);

      const [task0Data, task1Data]: [TaskResponse, TaskResponse] = await Promise.all([
        source0Response.json(),
        source1Response.json()
      ]);

      console.log("📋 Task 0:", task0Data.task);
      console.log("📋 Task 0 Data:", JSON.stringify(task0Data.data, null, 2));
      console.log("📋 Task 1:", task1Data.task);
      console.log("📋 Task 1 Data:", JSON.stringify(task1Data.data, null, 2));

      // For now, just return mock answers to test the flow
      const mockAnswer0 = "Mock answer for task 0";
      const mockAnswer1 = "Mock answer for task 1";

      // Step 5: Merge results
      const mergedAnswer = {
        source0: mockAnswer0,
        source1: mockAnswer1
      };

      console.log("📤 Would send final response:");
      const finalResponse = {
        apikey: "MOCK_API_KEY",
        timestamp: signData.timestamp,
        signature: signData.signature,
        answer: mergedAnswer
      };

      console.log(JSON.stringify(finalResponse, null, 2));
      
      const totalTime = Date.now() - startTime;
      console.log(`⏱️ Total execution time: ${totalTime}ms`);

      // Don't actually send in test mode
      console.log("🧪 Test mode - not sending actual response");

      return finalResponse;

    } catch (error) {
      console.error("❌ Error:", error);
      throw error;
    }
  }
}

// Run the test
const exercise = new Exercise23Test();
exercise.run().catch(console.error);
