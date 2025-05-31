interface DatabaseApiRequest {
  task: string;
  apikey: string;
  query: string;
}

interface DatabaseAnswerRequest {
  task: string;
  apikey: string;
  answer: number[];
}

interface DatabaseApiResponse {
  reply?: any[];
  error?: string;
  message?: string;
}

interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  max_tokens?: number;
  temperature?: number;
}

interface OpenAIResponse {
  choices: {
    message: {
      content: string;
    };
  }[];
}

class OpenAIService {
  private readonly apiKey: string;
  private readonly apiUrl = "https://api.openai.com/v1/chat/completions";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async generateQuery(prompt: string): Promise<string> {
    const requestBody: OpenAIRequest = {
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content:
            "You are a SQL expert. Generate only the SQL query without any explanations, comments, or formatting. Return just the raw SQL query that can be executed directly.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 200,
      temperature: 0.1,
    };

    try {
      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error! status: ${response.status}`);
      }

      const data: OpenAIResponse = await response.json();
      return data.choices[0].message.content.trim();
    } catch (error) {
      console.error("Error generating query with OpenAI:", error);
      throw error;
    }
  }
}

class DatabaseApiClient {
  private readonly apiUrl = "https://c3ntrala.ag3nts.org/apidb";
  private readonly reportUrl = "https://c3ntrala.ag3nts.org/report";
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async executeQuery(query: string): Promise<DatabaseApiResponse> {
    const requestBody: DatabaseApiRequest = {
      task: "database",
      apikey: this.apiKey,
      query: query,
    };

    try {
      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: DatabaseApiResponse = await response.json();
      return data;
    } catch (error) {
      console.error("Error executing query:", error);
      throw error;
    }
  }

  async showTables(): Promise<DatabaseApiResponse> {
    return this.executeQuery("SHOW TABLES");
  }

  async showCreateTable(tableName: string): Promise<DatabaseApiResponse> {
    return this.executeQuery(`SHOW CREATE TABLE ${tableName}`);
  }

  async selectFromTable(
    tableName: string,
    limit?: number
  ): Promise<DatabaseApiResponse> {
    const limitClause = limit ? ` LIMIT ${limit}` : "";
    return this.executeQuery(`SELECT * FROM ${tableName}${limitClause}`);
  }

  async customQuery(query: string): Promise<DatabaseApiResponse> {
    return this.executeQuery(query);
  }

  async submitAnswer(
    answer: number[],
    taskType: string = "database"
  ): Promise<DatabaseApiResponse> {
    const requestBody: any = {
      task: taskType,
      apikey: this.apiKey,
      answer: answer,
    };

    try {
      console.log(
        `📤 Sending answer to report endpoint:`,
        JSON.stringify(requestBody, null, 2)
      );

      const response = await fetch(this.reportUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      const data: DatabaseApiResponse = await response.json();

      if (!response.ok) {
        console.error("❌ API Error Response:", JSON.stringify(data, null, 2));
        throw new Error(
          `HTTP error! status: ${response.status}, response: ${JSON.stringify(data)}`
        );
      }

      return data;
    } catch (error) {
      console.error("Error submitting answer:", error);
      throw error;
    }
  }
}

// Example usage
async function main() {
  // Replace 'YOUR_API_KEY_HERE' with your actual API key
  const apiKey = process.env.API_KEY || "YOUR_API_KEY_HERE";
  const openaiKey = process.env.OPENAI_API_KEY || "YOUR_OPENAI_API_KEY";

  const dbClient = new DatabaseApiClient(apiKey);

  try {
    // First, get the database schema
    console.log("🔍 Analyzing database schema...");
    const tablesResult = await dbClient.showTables();

    if (!tablesResult.reply) {
      throw new Error("Could not fetch database tables");
    }

    // Get schema for all tables
    const tableSchemas: string[] = [];
    for (const table of tablesResult.reply) {
      const tableName =
        typeof table === "object" ? Object.values(table)[0] : table;
      const createTableResult = await dbClient.showCreateTable(
        tableName as string
      );
      if (createTableResult.reply) {
        const createStatement = createTableResult.reply[0]["Create Table"];
        tableSchemas.push(`-- Table: ${tableName}\n${createStatement}`);
      }
    }

    const schemaText = tableSchemas.join("\n\n");
    console.log("📋 Database schema analyzed");

    // Use OpenAI to generate the query
    if (openaiKey && openaiKey !== "YOUR_OPENAI_API_KEY") {
      console.log("🤖 Using OpenAI to generate SQL query...");

      const openaiService = new OpenAIService(openaiKey);

      const prompt = `Given this database schema:

${schemaText}

Generate a SQL query that returns the DC_ID of active data centers whose managers (from the users table) are inactive.

Requirements:
- Find data centers where is_active = 1 (active data centers)
- The manager field in datacenters table references the id field in users table
- Find managers where is_active = 0 (inactive users)
- Return only the dc_id column

Generate only the SQL query, no explanations.`;

      console.log("🎯 Generated SQL Query using OpenAI:");
      const targetQuery = await openaiService.generateQuery(prompt);
      console.log(targetQuery);

      console.log("\n🔍 Executing AI-generated query...");
      const result = await dbClient.customQuery(targetQuery);
      console.log("Result:", JSON.stringify(result, null, 2));

      // Extract and submit the answer
      if (result.reply && result.reply.length > 0) {
        const dcIds = result.reply.map((row) => parseInt(row.dc_id));
        console.log("\n📋 Answer to submit:");
        console.log("DC_IDs found:", dcIds);

        console.log("\n📤 Submitting answer to /report endpoint...");
        const answerResult = await dbClient.submitAnswer(dcIds);
        console.log(
          "✅ Answer submission result:",
          JSON.stringify(answerResult, null, 2)
        );
      }
    }
  } catch (error) {
    console.error("Error:", error);
  }
}

// Run the example
main();
