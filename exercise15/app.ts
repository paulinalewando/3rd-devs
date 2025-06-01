import { Neo4jService } from "./Neo4jService";
import { OpenAIService } from "./OpenAIService";
import fs from "fs/promises";
import path from "path";

interface User {
  id: string;
  username: string;
  access_level: string;
  is_active: string;
  lastlog: string;
  connections: {
    connected_users: string[];
    connection_count: number;
  };
}

if (
  !process.env.NEO4J_URI ||
  !process.env.NEO4J_USER ||
  !process.env.NEO4J_PASSWORD
) {
  throw new Error("NEO4J_URI, NEO4J_USER, and NEO4J_PASSWORD must be set");
}

const openAIService = new OpenAIService();
const neo4jService = new Neo4jService(
  process.env.NEO4J_URI,
  process.env.NEO4J_USER,
  process.env.NEO4J_PASSWORD,
  openAIService
);

async function loadUsersData(): Promise<User[]> {
  try {
    // Try multiple possible paths
    const possiblePaths = [
      path.join(__dirname, "users_with_connections.json"),
      path.join(process.cwd(), "exercise15", "users_with_connections.json"),
      path.join(process.cwd(), "users_with_connections.json"),
      "/Users/Paulina/Repos/3rd-devs/exercise15/users_with_connections.json",
    ];

    let data: string;
    let foundPath: string | null = null;

    for (const filePath of possiblePaths) {
      try {
        data = await fs.readFile(filePath, "utf-8");
        foundPath = filePath;
        console.log(`Found users data at: ${filePath}`);
        break;
      } catch (err) {
        // Continue to next path
        continue;
      }
    }

    if (!foundPath) {
      throw new Error(
        `Could not find users_with_connections.json in any of these locations: ${possiblePaths.join(", ")}`
      );
    }

    return JSON.parse(data!);
  } catch (error) {
    console.error("Error loading users data:", error);
    throw error;
  }
}

async function clearDatabase(): Promise<void> {
  console.log("Clearing existing database...");
  const clearQuery = `
    MATCH (n)
    DETACH DELETE n
  `;
  await neo4jService.executeQuery(clearQuery);
  console.log("Database cleared.");
}

async function createUsersGraph(): Promise<void> {
  try {
    console.log("Loading users data...");
    const users = await loadUsersData();

    console.log("Clearing existing database...");
    await clearDatabase();

    console.log(`Creating ${users.length} user nodes...`);
    // Create user nodes with clear labeling
    for (const user of users) {
      await neo4jService.addNode("User", {
        userId: user.id,
        username: user.username,
        access_level: user.access_level,
        is_active: user.is_active,
        lastlog: user.lastlog,
        connection_count: user.connections.connection_count,
      });
      console.log(`Created user: ${user.username} (ID: ${user.id})`);
    }

    console.log("Creating connections between users...");
    let connectionCount = 0;

    // Create bidirectional connections between users
    for (const user of users) {
      for (const connectedUserId of user.connections.connected_users) {
        // Find the nodes by userId
        const fromUser = await neo4jService.findNodeByProperty(
          "User",
          "userId",
          user.id
        );
        const toUser = await neo4jService.findNodeByProperty(
          "User",
          "userId",
          connectedUserId
        );

        if (fromUser && toUser) {
          // Create bidirectional relationship
          await neo4jService.connectNodes(
            fromUser.id,
            toUser.id,
            "CONNECTED_TO"
          );
          // Also create the reverse connection to make it bidirectional
          await neo4jService.connectNodes(
            toUser.id,
            fromUser.id,
            "CONNECTED_TO"
          );

          connectionCount += 2; // Count both directions
          console.log(
            `Connected: ${user.username} (${user.id}) <-> User ID ${connectedUserId}`
          );
        } else {
          console.warn(
            `Could not find nodes for connection: ${user.id} -> ${connectedUserId}`
          );
        }
      }
    }

    console.log(`Graph created successfully!`);
    console.log(`Total connections created: ${connectionCount}`);

    // Verify the graph was created properly
    const verifyQuery = `
      MATCH (u:User)
      RETURN count(u) as userCount
    `;
    const verifyResult = await neo4jService.executeQuery(verifyQuery);
    console.log(
      `Verified: ${verifyResult.records[0].get("userCount")} users in database`
    );

    const connectionVerifyQuery = `
      MATCH ()-[r:CONNECTED_TO]->()
      RETURN count(r) as connectionCount
    `;
    const connectionVerifyResult = await neo4jService.executeQuery(
      connectionVerifyQuery
    );
    console.log(
      `Verified: ${connectionVerifyResult.records[0].get("connectionCount")} connections in database`
    );
  } catch (error) {
    console.error("Error creating users graph:", error);
    throw error;
  }
}

async function findShortestPath(): Promise<void> {
  try {
    console.log("\nFinding shortest path between Rafał and Barbara...");

    // Query to find shortest path
    const shortestPathQuery = `
      MATCH (rafal:User {username: 'Rafał'}),
            (barbara:User {username: 'Barbara'}),
            path = shortestPath((rafal)-[:CONNECTED_TO*]-(barbara))
      RETURN path, length(path) as pathLength,
             [node in nodes(path) | node.username] as usernames
    `;

    const result = await neo4jService.executeQuery(shortestPathQuery);

    if (result.records.length === 0) {
      console.log("No path found between Rafał and Barbara!");

      // Let's check if both users exist
      const rafalQuery = `MATCH (u:User {username: 'Rafał'}) RETURN u`;
      const barbaraQuery = `MATCH (u:User {username: 'Barbara'}) RETURN u`;

      const rafalResult = await neo4jService.executeQuery(rafalQuery);
      const barbaraResult = await neo4jService.executeQuery(barbaraQuery);

      console.log(`Rafał found: ${rafalResult.records.length > 0}`);
      console.log(`Barbara found: ${barbaraResult.records.length > 0}`);

      return;
    }

    const record = result.records[0];
    const pathLength = record.get("pathLength");
    const usernames = record.get("usernames");

    console.log(`\nShortest path found!`);
    console.log(`Path length: ${pathLength} hops`);
    console.log(`Path: ${usernames.join(" -> ")}`);

    // Let's also get some additional details about the path
    const pathDetailsQuery = `
      MATCH (rafal:User {username: 'Rafał'}),
            (barbara:User {username: 'Barbara'}),
            path = shortestPath((rafal)-[:CONNECTED_TO*]-(barbara))
      RETURN [node in nodes(path) | {username: node.username, userId: node.userId, access_level: node.access_level}] as pathDetails
    `;

    const detailsResult = await neo4jService.executeQuery(pathDetailsQuery);
    if (detailsResult.records.length > 0) {
      const pathDetails = detailsResult.records[0].get("pathDetails");
      console.log("\nDetailed path:");
      pathDetails.forEach((user: any, index: number) => {
        console.log(
          `${index + 1}. ${user.username} (ID: ${user.userId}, Access: ${user.access_level})`
        );
      });
    }
  } catch (error) {
    console.error("Error finding shortest path:", error);
    throw error;
  }
}

async function analyzeConnections(): Promise<void> {
  try {
    console.log("\nAnalyzing network connections...");

    // Get total users and connections
    const statsQuery = `
      MATCH (u:User)
      WITH count(u) as totalUsers
      MATCH ()-[r:CONNECTED_TO]->()
      RETURN totalUsers, count(r) as totalConnections
    `;

    const statsResult = await neo4jService.executeQuery(statsQuery);
    const stats = statsResult.records[0];
    console.log(`Total users: ${stats.get("totalUsers")}`);
    console.log(`Total connections: ${stats.get("totalConnections")}`);

    // Find users with most connections
    const topConnectedQuery = `
      MATCH (u:User)-[r:CONNECTED_TO]-()
      WITH u, count(r) as connections
      ORDER BY connections DESC
      LIMIT 5
      RETURN u.username, u.userId, connections
    `;

    const topResult = await neo4jService.executeQuery(topConnectedQuery);
    console.log("\nTop 5 most connected users:");
    topResult.records.forEach((record: any, index: number) => {
      console.log(
        `${index + 1}. ${record.get("u.username")} (ID: ${record.get("u.userId")}) - ${record.get("connections")} connections`
      );
    });
  } catch (error) {
    console.error("Error analyzing connections:", error);
    throw error;
  }
}

async function displaySampleGraph(): Promise<void> {
  try {
    console.log("\n=== SAMPLE GRAPH STRUCTURE ===");

    // Display some sample users
    const sampleUsersQuery = `
      MATCH (u:User)
      RETURN u.username, u.userId, u.access_level
      LIMIT 5
    `;
    const sampleResult = await neo4jService.executeQuery(sampleUsersQuery);

    console.log("\nSample Users:");
    sampleResult.records.forEach((record: any, index: number) => {
      console.log(
        `${index + 1}. ${record.get("u.username")} (ID: ${record.get("u.userId")}, Access: ${record.get("u.access_level")})`
      );
    });

    // Display some sample connections
    const sampleConnectionsQuery = `
      MATCH (u1:User)-[r:CONNECTED_TO]->(u2:User)
      RETURN u1.username, u1.userId, u2.username, u2.userId
      LIMIT 10
    `;
    const connectionResult = await neo4jService.executeQuery(
      sampleConnectionsQuery
    );

    console.log("\nSample Connections:");
    connectionResult.records.forEach((record: any, index: number) => {
      console.log(
        `${index + 1}. ${record.get("u1.username")} (${record.get("u1.userId")}) -> ${record.get("u2.username")} (${record.get("u2.userId")})`
      );
    });

    // Show Rafał and Barbara specifically
    console.log("\n=== TARGET USERS ===");
    const rafalQuery = `MATCH (u:User {username: 'Rafał'}) RETURN u.username, u.userId, u.access_level`;
    const barbaraQuery = `MATCH (u:User {username: 'Barbara'}) RETURN u.username, u.userId, u.access_level`;

    const rafalResult = await neo4jService.executeQuery(rafalQuery);
    const barbaraResult = await neo4jService.executeQuery(barbaraQuery);

    if (rafalResult.records.length > 0) {
      const rafal = rafalResult.records[0];
      console.log(
        `Rafał: ${rafal.get("u.username")} (ID: ${rafal.get("u.userId")}, Access: ${rafal.get("u.access_level")})`
      );

      // Show Rafał's connections
      const rafalConnectionsQuery = `
        MATCH (rafal:User {username: 'Rafał'})-[r:CONNECTED_TO]->(connected:User)
        RETURN connected.username, connected.userId
        LIMIT 5
      `;
      const rafalConnections = await neo4jService.executeQuery(
        rafalConnectionsQuery
      );
      console.log(`Rafał's connections (showing first 5):`);
      rafalConnections.records.forEach((record: any, index: number) => {
        console.log(
          `  ${index + 1}. ${record.get("connected.username")} (${record.get("connected.userId")})`
        );
      });
    }

    if (barbaraResult.records.length > 0) {
      const barbara = barbaraResult.records[0];
      console.log(
        `Barbara: ${barbara.get("u.username")} (ID: ${barbara.get("u.userId")}, Access: ${barbara.get("u.access_level")})`
      );

      // Show Barbara's connections
      const barbaraConnectionsQuery = `
        MATCH (barbara:User {username: 'Barbara'})-[r:CONNECTED_TO]->(connected:User)
        RETURN connected.username, connected.userId
        LIMIT 5
      `;
      const barbaraConnections = await neo4jService.executeQuery(
        barbaraConnectionsQuery
      );
      console.log(`Barbara's connections (showing first 5):`);
      barbaraConnections.records.forEach((record: any, index: number) => {
        console.log(
          `  ${index + 1}. ${record.get("connected.username")} (${record.get("connected.userId")})`
        );
      });
    }
  } catch (error) {
    console.error("Error displaying sample graph:", error);
    throw error;
  }
}

async function main(): Promise<void> {
  try {
    await createUsersGraph();
    await displaySampleGraph();
    await analyzeConnections();
    await findShortestPath();
  } catch (error) {
    console.error("Error in main:", error);
  } finally {
    await neo4jService.close();
  }
}

main();

async function sendReport(): Promise<string> {
  const reportData = {
    task: "connections",
    apikey: process.env.PERSONAL_API_KEY,
    answer: "Rafał,Azazel,Aleksander,Barbara",
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
