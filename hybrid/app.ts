import type { ChatCompletion } from "openai/resources/chat/completions";
import { v4 as uuidv4 } from "uuid";
import { DatabaseService } from "./DatabaseService";
import { AlgoliaService } from "./AlgoliaService";
import { VectorService } from "./VectorService";
import { OpenAIService } from "./OpenAIService";
import { data } from "./data";

const openAIService = new OpenAIService();
const algoliaService = new AlgoliaService(
  process.env.ALGOLIA_APP_ID!,
  process.env.ALGOLIA_API_KEY!
);
const vectorService = new VectorService(openAIService);
const dbService = new DatabaseService(
  "hybrid/database.db",
  algoliaService,
  vectorService
);

async function determineAuthors(query: string): Promise<string[]> {
  const completion = (await openAIService.completion({
    messages: [
      {
        role: "system",
        content: `You are a helpful assistant that determines the author(s) of a given text.
                  Pick between Jim Collins and Simon Sinek or pick them both.

                  Rule: When the query does not explicitly mention an author, always list both authors.

                  Write the list of author(s) as a comma-separated list and nothing else.`,
      },
      { role: "user", content: query },
    ],
  })) as ChatCompletion;

  return (
    completion.choices[0].message.content?.split(",").map((a) => a.trim()) || []
  );
}

function buildFilter(authors: string[]) {
  if (authors.length === 0) return undefined;
  return {
    should: authors.map((author) => ({
      key: "author",
      match: {
        value: author,
      },
    })),
  };
}

function buildAlgoliaFilter(authors: string[]): string {
  return authors.length > 0
    ? authors.map((author) => `author:'${author.trim()}'`).join(" OR ")
    : "";
}

async function performVectorSearch(query: string, filter: any): Promise<any[]> {
  return vectorService.performSearch("documents", query, filter, 15);
}

async function performAlgoliaSearch(
  denseQuery: string,
  params: any = {}
): Promise<any[]> {
  return algoliaService.searchSingleIndex("documents", denseQuery, {
    queryParameters: params,
  });
}

function calculateRRF(vectorResults: any[], algoliaResults: any[]) {
  const allResults = [...vectorResults, ...algoliaResults];

  const resultMap = new Map(
    allResults.map((result) => [
      result.uuid,
      {
        ...result,
        vectorRank: vectorResults.findIndex((r) => r.uuid === result.uuid) + 1,
        algoliaRank:
          algoliaResults.findIndex((r) => r.uuid === result.uuid) + 1,
      },
    ])
  );

  return Array.from(resultMap.values())
    .map((data) => ({
      ...data,
      score:
        (data.vectorRank ? 1 / data.vectorRank : 0) +
        (data.algoliaRank ? 1 / data.algoliaRank : 0),
    }))
    .sort((a, b) => b.score - a.score);
}

async function initializeData() {
  const docs = await dbService.getAllDocuments();

  // Ensure the Qdrant collection exists regardless of whether we have data
  try {
    console.log("Ensuring Qdrant collection exists...");
    await vectorService.ensureCollection("documents");
    console.log("Qdrant collection 'documents' is ready");
  } catch (error) {
    console.error("Error ensuring Qdrant collection:", error);
    return; // Exit early if we can't create the collection
  }

  // Initialize data if the database is empty
  if (docs.length === 0) {
    console.log("Database is empty, initializing with sample data...");
    for (const book of data) {
      const document = {
        uuid: uuidv4(),
        name: book.title,
        author: book.author,
        content: book.text,
        source: "initialization",
        isbn: book.isbn,
        conversation_uuid: uuidv4(),
        type: "book",
        indexed: true,
      };

      // Insert into SQLite database, which will sync to Algolia and Qdrant
      await dbService.insertDocument(document);
    }
  } else {
    console.log("Database already has data, skipping initialization");
  }

  // Query for the vector search and full-text search
  const QUERY = "flywheel effect momentum";
  const DENSE_QUERY = "flywheel effect momentum";

  // Determine the authors based on the query
  console.log("Determining authors for query:", QUERY);
  const authors = await determineAuthors(QUERY);
  const filter = buildFilter(authors);

  // Vector search
  let vectorResults: any[] = [];
  try {
    console.log("Performing vector search...");
    // Remove the filter for now since Qdrant doesn't have an index for 'author'
    vectorResults = await performVectorSearch(QUERY, {});
    console.log("Vector results count:", vectorResults.length);
    console.log("Vector results:");
    vectorResults.forEach((result) => {
      const author = result.author || "";
      const textSnippet = result.content.slice(0, 75) || "";
      const score = (result.score * 100).toFixed(2);
      console.log(`${author}: ${textSnippet} (${score}%)`);
    });
  } catch (error) {
    console.error("Error in vector search:", error);
  }

  // Full-text search
  try {
    console.log("Performing Algolia search...");
    const algoliaResults = await performAlgoliaSearch(DENSE_QUERY, {
      filters: buildAlgoliaFilter(authors),
    });
    console.log("Algolia results count:", algoliaResults.length);
    console.log("Algolia results:");
    algoliaResults.forEach((hit) => {
      console.log(hit.author + ": " + hit.content.slice(0, 50));
    });

    // Calculate RRF scores using actual results
    const rrfScores = calculateRRF(vectorResults, algoliaResults);

    console.log(`Query: ${QUERY}`);
    console.log(`Author(s): ${authors.join(", ")}`);
    console.log("RRF results count:", rrfScores.length);
    console.table(
      rrfScores.map((result) => ({
        Author: result.author,
        Text: result.content.slice(0, 75) + "...",
        "RRF Score": result.score.toFixed(4),
      }))
    );
  } catch (error) {
    console.error("Error in Algolia search:", error);
  }

  console.log(
    "Initialization complete. Example data has been added to all stores."
  );
}

initializeData().catch(console.error);
