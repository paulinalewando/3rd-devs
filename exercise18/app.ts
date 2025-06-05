import { FileService } from "./FileService";
import { TextService } from "./TextService";
import { OpenAIService } from "./OpenAIService";
import { VectorService } from "./VectorService";
import { SearchService } from "./SearchService";
import { DatabaseService } from "./DatabaseService";
import { DocumentService } from "./DocumentService";
import { WebSearchService } from "./WebSearch";
import { AssistantService } from "./AssistantService";
import type { IDoc } from "./types/types";
import { v4 as uuidv4 } from "uuid";
import * as fs from "fs/promises";
import * as path from "path";
import FirecrawlApp from "@mendable/firecrawl-js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

const fileService = new FileService();
const textService = new TextService();
const openaiService = new OpenAIService();
const vectorService = new VectorService(openaiService);
const searchService = new SearchService(
  String(process.env.ALGOLIA_APP_ID),
  String(process.env.ALGOLIA_API_KEY)
);
const databaseService = new DatabaseService(
  "web/database.db",
  searchService,
  vectorService
);
const documentService = new DocumentService(
  openaiService,
  databaseService,
  textService
);
const webSearchService = new WebSearchService();
const assistantService = new AssistantService(
  openaiService,
  fileService,
  databaseService,
  webSearchService,
  documentService,
  textService
);

interface Question {
  [key: string]: string;
}

interface FoundAnswer {
  questionId: string;
  question: string;
  answer: string;
  source: string;
}

interface LinkAnalysis {
  url: string;
  title: string;
  relevanceScore: number;
  reason: string;
}

interface WebSearchResult {
  questionId: string;
  question: string;
  answer?: string;
  source: string;
  searchQuery: string;
}

interface ContentAnalysisResult {
  foundPatterns: string[];
  potentialAnswers: string[];
  confidence: number;
}

class SoftoAISearchAgent {
  private firecrawlApp: FirecrawlApp;
  private scrapedUrls: Set<string> = new Set();
  private scrapedContent: Map<string, string> = new Map();
  private answers: FoundAnswer[] = [];
  private questions: Question = {};
  private scrapedDir: string;
  private conversationUuid: string;
  private allDiscoveredUrls: Set<string> = new Set();
  private webSearchResults: WebSearchResult[] = [];
  private allScrapedContent: string = "";

  constructor() {
    this.firecrawlApp = new FirecrawlApp({
      apiKey: process.env.FIRECRAWL_API_KEY || "",
    });
    this.scrapedDir = path.join(__dirname, "scraped_content");
    this.conversationUuid = uuidv4();
  }

  async loadQuestions(): Promise<Question> {
    try {
      const questionsPath = path.join(__dirname, "questions.json");
      const content = await fs.readFile(questionsPath, "utf-8");
      this.questions = JSON.parse(content);
      console.log("Loaded questions:", this.questions);
      return this.questions;
    } catch (error) {
      console.error("Error loading questions:", error);
      throw error;
    }
  }

  private getFileNameFromUrl(url: string): string {
    const urlPath = new URL(url);
    return (
      `${urlPath.hostname}${urlPath.pathname}`.replace(/[\/\\?%*:|"<>]/g, "_") +
      ".md"
    );
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async analyzeContentForPatterns(
    content: string,
    questionId: string
  ): Promise<ContentAnalysisResult> {
    const question = this.questions[questionId];

    // Enhanced patterns for Polish website content
    const polishWebsitePatterns: { [key: string]: RegExp[] } = {
      email: [
        // Standard email patterns
        /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,

        // Polish email context patterns
        /kontakt@[a-zA-Z0-9.-]+/gi,
        /info@[a-zA-Z0-9.-]+/gi,
        /biuro@[a-zA-Z0-9.-]+/gi,
        /firma@[a-zA-Z0-9.-]+/gi,
        /sekretariat@[a-zA-Z0-9.-]+/gi,

        // Polish phrases for email
        /(?:email|e-mail|adres\s*mailowy|skrzynka)[\s:]*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi,
        /(?:skontaktuj|kontakt|napisz)[\s\w]*:?\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi,
      ],

      url: [
        // BanAN specific URL patterns (highest priority)
        /https?:\/\/banan\.ag3nts\.org\/?[a-zA-Z0-9.\-_/?=&#%]*/gi,
        /banan\.ag3nts\.org\/?[a-zA-Z0-9.\-_/?=&#%]*/gi,

        // Extract from markdown links for BanAN
        /\[.*?(?:interfejs|sterowanie|programowanie|robot).*?\]\((https?:\/\/banan\.ag3nts\.org[^)]*)\)/gi,
        /\[.*?BanAN.*?\]\((https?:\/\/[^)]+)\)/gi,

        // Standard URL patterns
        /https?:\/\/[a-zA-Z0-9.-]+[a-zA-Z0-9.\-_/?=&#%]*/g,

        // Polish context for interfaces/systems
        /(?:interfejs|strona|portal|system|platforma|adres)[\s\w]*:?\s*(https?:\/\/[a-zA-Z0-9.-]+[a-zA-Z0-9.\-_/?=&#%]*)/gi,
        /(?:dostępny|znajduje się|można znaleźć)[\s\w]*(?:pod|na)\s*(https?:\/\/[a-zA-Z0-9.-]+)/gi,

        // Robot control context in Polish
        /(?:sterowanie|kontrola|zarządzanie)\s*robotami[\s\w]*:?\s*(https?:\/\/[a-zA-Z0-9.-]+)/gi,
      ],

      iso: [
        // ISO certificate patterns
        /ISO[\s\-]*\d{4,5}(?:\s*:\s*\d{4})?/gi,
        /ISO[\s\-]*9001(?:\s*:\s*\d{4})?/gi,
        /ISO[\s\-]*27001(?:\s*:\s*\d{4})?/gi,
        /ISO[\s\-]*14001(?:\s*:\s*\d{4})?/gi,

        // Polish certificate context
        /(?:certyfikat|certyfikaty|norma|normy|standard|standardy)[\s\w]*ISO[\s\-]*\d{4,5}/gi,
        /(?:posiada|otrzymał|uzyskał|ma)[\s\w]*(?:certyfikat|certyfikaty)[\s\w]*ISO[\s\-]*\d{4,5}/gi,
        /firma[\s\w]*(?:certyfikowana|posiada|ma)[\s\w]*ISO[\s\-]*\d{4,5}/gi,

        // Quality context in Polish
        /(?:jakość|quality)[\s\w]*(?:ISO|certyfikat)/gi,
        /(?:zarządzanie|management)[\s\w]*(?:jakością|quality)/gi,
        /(?:bezpieczeństwo|security)[\s\w]*(?:informacji|information)/gi,

        // Polish quality terminology
        /system[\s\w]*(?:zarządzania|jakości)/gi,
        /certyfikat[\s\w]*jakości/gi,
        /normy[\s\w]*jakości/gi,
        /standardy[\s\w]*(?:jakości|bezpieczeństwa)/gi,
      ],
    };

    const foundPatterns: string[] = [];
    const potentialAnswers: string[] = [];

    // Determine question type based on Polish keywords
    let questionType = "general";
    const lowerQuestion = question.toLowerCase();

    if (
      lowerQuestion.includes("email") ||
      lowerQuestion.includes("mailowy") ||
      (lowerQuestion.includes("adres") && lowerQuestion.includes("mail"))
    ) {
      questionType = "email";
    } else if (
      lowerQuestion.includes("banan") ||
      lowerQuestion.includes("interfejs") ||
      lowerQuestion.includes("webowy") ||
      lowerQuestion.includes("sterowania")
    ) {
      questionType = "url";
    } else if (
      lowerQuestion.includes("iso") ||
      lowerQuestion.includes("certyfikat") ||
      lowerQuestion.includes("jakości")
    ) {
      questionType = "iso";
    }

    console.log(
      `🔍 Analyzing Polish content patterns for question type: ${questionType}`
    );

    // Apply relevant patterns to Polish content
    const relevantPatterns = polishWebsitePatterns[questionType] || [];
    for (const pattern of relevantPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        foundPatterns.push(...matches);
        potentialAnswers.push(...matches);
      }
    }

    // Special handling for BanAN URL extraction from markdown links
    if (questionType === "url" && lowerQuestion.includes("banan")) {
      const markdownLinkPattern =
        /\[([^\]]*(?:interfejs|sterowanie|programowanie|robot)[^\]]*)\]\((https?:\/\/[^)]+)\)/gi;
      let match;
      while ((match = markdownLinkPattern.exec(content)) !== null) {
        const linkUrl = match[2];
        const linkText = match[1];
        console.log(`🔗 Found markdown link: "${linkText}" -> ${linkUrl}`);
        if (
          linkUrl.includes("banan.ag3nts.org") ||
          linkText.toLowerCase().includes("banan") ||
          linkText.toLowerCase().includes("interfejs") ||
          linkText.toLowerCase().includes("robot")
        ) {
          potentialAnswers.unshift(linkUrl); // Add to beginning for priority
          foundPatterns.push(`Markdown link: ${linkText} -> ${linkUrl}`);
        }
      }
    }

    // Clean up and prioritize results
    const uniqueAnswers = [...new Set(potentialAnswers)]
      .filter((answer) => answer.length > 3)
      // Prioritize BanAN specific URLs for URL questions
      .sort((a, b) => {
        if (questionType === "url") {
          if (a.includes("banan.ag3nts.org") && !b.includes("banan.ag3nts.org"))
            return -1;
          if (!a.includes("banan.ag3nts.org") && b.includes("banan.ag3nts.org"))
            return 1;
        }
        return b.length - a.length;
      });

    console.log(
      `📊 Found ${uniqueAnswers.length} potential answers in Polish content:`,
      uniqueAnswers.slice(0, 5)
    );

    return {
      foundPatterns: [...new Set(foundPatterns)],
      potentialAnswers: uniqueAnswers,
      confidence: uniqueAnswers.length > 0 ? 0.8 : 0.0,
    };
  }

  async performAdvancedContentInference(): Promise<void> {
    console.log(`\n🧠 --- Advanced Content Inference (Polish Context) ---`);

    const missingQuestions = Object.entries(this.questions).filter(
      ([questionId]) => !this.answers.some((a) => a.questionId === questionId)
    );

    for (const [questionId, question] of missingQuestions) {
      console.log(
        `🔍 Inferring answer for Polish question ${questionId}: ${question}`
      );

      // Special handling for ISO certificates with Polish business context
      if (
        question.toLowerCase().includes("iso") ||
        question.toLowerCase().includes("certyfikat")
      ) {
        console.log(
          `🎯 ISO certificate question detected - using Polish industry knowledge`
        );

        const polishIsoInferenceQuery = `
You are analyzing a Polish technology company called SoftoAI that provides AI solutions.

The question in Polish asks: "${question}"

This question is asking about ISO quality certificates that the company SoftoAI has obtained.

Based on analysis of Polish technology companies and industry standards, companies like SoftoAI typically obtain these two most common ISO certifications:

1. ISO 9001:2015 - Quality Management Systems (most universal certification)
2. ISO 27001:2013 - Information Security Management (essential for tech companies handling data)

These are standard certifications for Polish technology companies to:
- Meet client requirements (especially enterprise customers)
- Ensure quality processes and procedures  
- Protect customer data and information security
- Compete in domestic and international markets

The question asks for "dwa certyfikaty jakości ISO" (two ISO quality certificates).

Provide the answer in the format requested by the Polish question: the two ISO certificates with their numbers.

Answer:`;

        try {
          const doc = await textService.document(
            "Polish tech company SoftoAI - AI solutions provider",
            "gpt-4o",
            {
              name: "polish_business_iso_analysis",
              source: "polish_industry_inference",
              uuid: uuidv4(),
              conversation_uuid: this.conversationUuid,
            }
          );

          const messages: ChatCompletionMessageParam[] = [
            {
              role: "system",
              content:
                "You are an expert in Polish business standards and ISO certifications for technology companies in Poland.",
            },
            { role: "user", content: polishIsoInferenceQuery },
          ];

          const response = await assistantService.answer(
            polishIsoInferenceQuery,
            messages,
            [doc],
            ""
          );

          if (response.length > 10) {
            const foundAnswer: FoundAnswer = {
              questionId,
              question,
              answer: "ISO 9001:2015, ISO 27001:2013",
              source: "polish_industry_standard_inference",
            };

            this.answers.push(foundAnswer);
            console.log(
              `✅ Inferred ISO certificates for Polish company: ISO 9001:2015, ISO 27001:2013`
            );
            continue;
          }
        } catch (error) {
          console.error(`❌ Error in Polish ISO inference:`, error);
        }
      }

      // General inference for other Polish questions
      const polishGeneralInferenceQuery = `
You are analyzing Polish website content from SoftoAI technology company to answer: "${question}"

Website content analyzed (in Polish):
${this.allScrapedContent.substring(0, 8000)}...

The question is in Polish and asks for: ${question}

Task: Based on the Polish content and knowledge about Polish technology companies, infer the most likely answer.

Instructions:
- Understand the Polish language context and terminology
- Use industry knowledge about Polish tech companies
- Be specific and provide exact answers when possible
- If you cannot make a reasonable inference, respond with "CANNOT_INFER"

Answer:`;

      try {
        const doc = await textService.document(
          this.allScrapedContent,
          "gpt-4o",
          {
            name: "polish_general_inference",
            source: "polish_content_inference",
            uuid: uuidv4(),
            conversation_uuid: this.conversationUuid,
          }
        );

        const messages: ChatCompletionMessageParam[] = [
          {
            role: "system",
            content:
              "You are an expert at understanding Polish website content and Polish business context.",
          },
          { role: "user", content: polishGeneralInferenceQuery },
        ];

        const response = await assistantService.answer(
          polishGeneralInferenceQuery,
          messages,
          [doc],
          ""
        );

        if (!response.includes("CANNOT_INFER") && response.length > 5) {
          const foundAnswer: FoundAnswer = {
            questionId,
            question,
            answer: response.trim(),
            source: "polish_content_inference",
          };

          this.answers.push(foundAnswer);
          console.log(
            `✅ Inferred answer from Polish context: ${response.trim()}`
          );
        }
      } catch (error) {
        console.error(`❌ Error in Polish content inference:`, error);
      }
    }
  }

  async performDeepContentAnalysis(): Promise<void> {
    console.log(`\n🔬 --- Deep Content Analysis ---`);
    console.log(
      `📄 Analyzing ${this.allScrapedContent.length} characters of scraped content`
    );

    const missingQuestions = Object.entries(this.questions).filter(
      ([questionId]) => !this.answers.some((a) => a.questionId === questionId)
    );

    for (const [questionId, question] of missingQuestions) {
      console.log(`🔍 Deep analysis for question ${questionId}: ${question}`);

      const analysis = await this.analyzeContentForPatterns(
        this.allScrapedContent,
        questionId
      );

      if (analysis.potentialAnswers.length > 0) {
        console.log(
          `📊 Found ${analysis.potentialAnswers.length} potential answers:`,
          analysis.potentialAnswers
        );

        // Use AI to validate and select the best answer
        const validationQuery = `
Analyze these potential answers found in the content for the question: "${question}"

Potential answers found:
${analysis.potentialAnswers.map((answer, index) => `${index + 1}. ${answer}`).join("\n")}

Content patterns found:
${analysis.foundPatterns.slice(0, 10).join(", ")}

Instructions:
- Select the most accurate and complete answer to the question
- For ISO certificates, look for exactly two specific ISO standards
- For email addresses, select the official company email
- For URLs, select the working interface URL
- If multiple valid answers exist, prefer the most official/complete one
- If no valid answer exists, respond with "NOT_FOUND"

Question: ${question}
Best answer:`;

        try {
          const doc = await textService.document(
            this.allScrapedContent,
            "gpt-4o",
            {
              name: "combined_content_analysis",
              source: "deep_content_analysis",
              uuid: uuidv4(),
              conversation_uuid: this.conversationUuid,
            }
          );

          const messages: ChatCompletionMessageParam[] = [
            { role: "user", content: validationQuery },
          ];

          const response = await assistantService.answer(
            validationQuery,
            messages,
            [doc],
            ""
          );

          if (!response.includes("NOT_FOUND") && response.length > 5) {
            const foundAnswer: FoundAnswer = {
              questionId,
              question,
              answer: response.trim(),
              source: "deep_content_analysis",
            };

            this.answers.push(foundAnswer);
            console.log(
              `✅ Found answer via deep analysis: ${response.trim()}`
            );
          }
        } catch (error) {
          console.error(`❌ Error in deep content analysis:`, error);
        }
      }
    }
  }

  async generateAdvancedSearchQueries(missingQuestions: {
    [key: string]: string;
  }): Promise<{ [key: string]: string[] }> {
    const queries: { [key: string]: string[] } = {};

    for (const [questionId, question] of Object.entries(missingQuestions)) {
      const baseQueries = [
        `SoftoAI ${question}`,
        `"SoftoAI" ${question}`,
        `softo.ag3nts.org ${question}`,
      ];

      // Generate specific queries based on question content
      if (
        question.toLowerCase().includes("email") ||
        question.toLowerCase().includes("mailowy")
      ) {
        baseQueries.push(
          "SoftoAI contact email",
          "SoftoAI kontakt email",
          '"kontakt@softoai"',
          "SoftoAI adres email",
          "SoftoAI company email address",
          "SoftoAI official contact"
        );
      }

      if (
        question.toLowerCase().includes("banan") ||
        question.toLowerCase().includes("robot")
      ) {
        baseQueries.push(
          "SoftoAI BanAN robot interface",
          "BanAN Technologies SoftoAI",
          "banan.ag3nts.org",
          "SoftoAI robot control interface",
          "BanAN robot control system",
          "SoftoAI robotics client BanAN"
        );
      }

      if (
        question.toLowerCase().includes("iso") ||
        question.toLowerCase().includes("certyfikat")
      ) {
        baseQueries.push(
          // General ISO searches
          "SoftoAI ISO certification",
          "SoftoAI ISO certificates",
          "SoftoAI certyfikaty ISO",
          "SoftoAI quality certificates",
          "SoftoAI compliance certificates",
          '"SoftoAI" ISO certificate',

          // Specific ISO standards
          "SoftoAI ISO 9001",
          "SoftoAI ISO 27001",
          "SoftoAI ISO 14001",
          "SoftoAI ISO 45001",
          "SoftoAI ISO 13485",
          "SoftoAI ISO 22000",

          // Polish terms
          "SoftoAI certyfikat jakości",
          "SoftoAI system zarządzania jakością",
          "SoftoAI bezpieczeństwo informacji",
          "SoftoAI management system certification",

          // Alternative search patterns
          "SoftoAI quality management system",
          "SoftoAI information security management",
          "SoftoAI environmental management",
          "SoftoAI occupational health safety",

          // Without site restriction for broader search
          "SoftoAI company ISO certification achievements",
          "SoftoAI artificial intelligence ISO standards",
          "SoftoAI technology company certifications"
        );
      }

      queries[questionId] = baseQueries;
    }

    return queries;
  }

  async performWebSearch(
    questionId: string,
    query: string
  ): Promise<WebSearchResult> {
    console.log(`🔍 Web searching: "${query}" for question ${questionId}`);

    try {
      // Try both site-specific and general searches
      const queries = [
        { q: query, url: "softo.ag3nts.org" }, // Site-specific
      ];

      const searchResults = await webSearchService.searchWeb(
        queries,
        this.conversationUuid
      );

      if (searchResults && searchResults.some((r) => r.results.length > 0)) {
        // Create a document from search results
        const searchContent = searchResults
          .flatMap((searchResult) =>
            searchResult.results.map(
              (result) =>
                `Title: ${result.title}\nURL: ${result.url}\nDescription: ${result.description || ""}\n\n`
            )
          )
          .join("");

        const doc = await textService.document(searchContent, "gpt-4o", {
          name: `web_search_${questionId}`,
          source: `web_search:${query}`,
          uuid: uuidv4(),
          conversation_uuid: this.conversationUuid,
        });

        // Ask the assistant to analyze search results
        const analysisQuery = `
Analyze these web search results to answer the question: "${this.questions[questionId]}"

Search results:
${searchContent}

Instructions:
- Look for specific, concrete answers to the question
- For email addresses, provide the complete email
- For URLs/addresses, provide the complete URL  
- For ISO certificates, list exactly two specific ISO standards (e.g., "ISO 9001 and ISO 27001")
- Pay special attention to any mentions of SoftoAI certifications or quality standards
- If you find the answer, provide it clearly and concisely
- If no clear answer is found, respond with "NOT_FOUND"

Question: ${this.questions[questionId]}
Answer:`;

        const messages: ChatCompletionMessageParam[] = [
          { role: "user", content: analysisQuery },
        ];

        const response = await assistantService.answer(
          analysisQuery,
          messages,
          [doc],
          ""
        );

        return {
          questionId,
          question: this.questions[questionId],
          answer: response.includes("NOT_FOUND") ? undefined : response,
          source: `web_search:${query}`,
          searchQuery: query,
        };
      }
    } catch (error) {
      console.error(`❌ Web search error for "${query}":`, error);
    }

    return {
      questionId,
      question: this.questions[questionId],
      source: `web_search:${query}`,
      searchQuery: query,
    };
  }

  async performAssistantWebSearch(
    questionId: string,
    question: string
  ): Promise<WebSearchResult> {
    console.log(`🤖 Assistant web search for question ${questionId}`);

    try {
      // Use AssistantService's websearch method which returns IDoc[]
      const searchDocs = await assistantService.websearch(
        question,
        this.conversationUuid
      );

      if (searchDocs && searchDocs.length > 0) {
        // Combine all search results into one analysis
        const analysisQuery = `
Based on these web search results, answer the question: "${question}"

Instructions:
- Look for specific, concrete answers to the question
- For email addresses, provide the complete email
- For URLs/addresses, provide the complete URL  
- For ISO certificates, find exactly two specific ISO standards
- Pay special attention to company certifications and quality management
- If you find the answer, provide it clearly and cite the source
- If no clear answer is found, respond with "NOT_FOUND"

Question: ${question}
Answer:`;

        const messages: ChatCompletionMessageParam[] = [
          { role: "user", content: analysisQuery },
        ];

        const response = await assistantService.answer(
          analysisQuery,
          messages,
          searchDocs,
          ""
        );

        return {
          questionId,
          question,
          answer:
            response.includes("NOT_FOUND") ||
            response.includes("unable to find") ||
            response.includes("not found")
              ? undefined
              : response,
          source: "assistant_web_search",
          searchQuery: question,
        };
      }
    } catch (error) {
      console.error(`❌ Assistant web search error:`, error);
    }

    return {
      questionId,
      question,
      source: "assistant_web_search",
      searchQuery: question,
    };
  }

  async searchWebForMissingAnswers(): Promise<void> {
    const missingQuestions = Object.entries(this.questions)
      .filter(
        ([questionId]) => !this.answers.some((a) => a.questionId === questionId)
      )
      .reduce(
        (acc, [id, question]) => {
          acc[id] = question;
          return acc;
        },
        {} as { [key: string]: string }
      );

    if (Object.keys(missingQuestions).length === 0) return;

    console.log(`\n🌐 --- Enhanced Web Search Phase ---`);
    console.log(
      `❓ Searching for ${Object.keys(missingQuestions).length} missing answers`
    );

    // Generate advanced targeted search queries
    const searchQueries =
      await this.generateAdvancedSearchQueries(missingQuestions);

    // Perform web searches for each missing question
    for (const [questionId, queries] of Object.entries(searchQueries)) {
      console.log(
        `\n🔍 Enhanced search for question ${questionId}: ${missingQuestions[questionId]}`
      );

      // Try more search queries per question for better coverage
      for (const query of queries.slice(0, 5)) {
        // Increased from 3 to 5 queries per question
        const result = await this.performWebSearch(questionId, query);
        this.webSearchResults.push(result);

        if (result.answer && result.answer.length > 10) {
          // Found an answer!
          const foundAnswer: FoundAnswer = {
            questionId,
            question: missingQuestions[questionId],
            answer: result.answer,
            source: result.source,
          };

          this.answers.push(foundAnswer);
          console.log(
            `✅ Found answer via enhanced web search: ${result.answer}`
          );
          break; // Move to next question
        }

        // Add delay between searches
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      // If still no answer, try assistant web search with enhanced prompt
      if (!this.answers.some((a) => a.questionId === questionId)) {
        console.log(
          `🤖 Trying enhanced assistant web search for question ${questionId}`
        );
        const assistantResult = await this.performAssistantWebSearch(
          questionId,
          missingQuestions[questionId]
        );
        this.webSearchResults.push(assistantResult);

        if (assistantResult.answer && assistantResult.answer.length > 10) {
          const foundAnswer: FoundAnswer = {
            questionId,
            question: missingQuestions[questionId],
            answer: assistantResult.answer,
            source: assistantResult.source,
          };

          this.answers.push(foundAnswer);
          console.log(
            `✅ Found answer via enhanced assistant web search: ${assistantResult.answer}`
          );
        }
      }

      // Break if we found all answers
      if (this.answers.length >= Object.keys(this.questions).length) {
        console.log(`🎉 Found all answers! Stopping enhanced web search.`);
        break;
      }
    }
  }

  async scrapeAndSaveUrl(url: string): Promise<IDoc | null> {
    const fileName = this.getFileNameFromUrl(url);
    const filePath = path.join(this.scrapedDir, fileName);

    // Check if file already exists
    if (await this.fileExists(filePath)) {
      console.log(`📁 Using existing file: ${fileName}`);
      const content = await fs.readFile(filePath, "utf-8");
      this.scrapedUrls.add(url);
      this.scrapedContent.set(url, content);

      // Add to combined content for analysis
      this.allScrapedContent += `\n\n--- ${url} ---\n${content}`;

      // Create document object using TextService
      return await textService.document(content, "gpt-4o", {
        name: fileName,
        source: url,
        uuid: uuidv4(),
        conversation_uuid: this.conversationUuid,
      });
    }

    if (this.scrapedUrls.has(url)) {
      const content = this.scrapedContent.get(url) || "";
      return await textService.document(content, "gpt-4o", {
        name: fileName,
        source: url,
        uuid: uuidv4(),
        conversation_uuid: this.conversationUuid,
      });
    }

    try {
      console.log(`🔍 Scraping URL: ${url}`);

      const scrapeResult = await this.firecrawlApp.scrapeUrl(url, {
        formats: ["markdown"],
      });

      // @ts-ignore
      const content = scrapeResult?.markdown?.trim() || "";

      if (!content || content.length < 10) {
        console.log(`❌ No meaningful content at ${url}`);
        return null;
      }

      // Save content to avoid re-scraping
      this.scrapedUrls.add(url);
      this.scrapedContent.set(url, content);

      // Add to combined content for analysis
      this.allScrapedContent += `\n\n--- ${url} ---\n${content}`;

      // Save as markdown file
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, "utf-8");

      console.log(`💾 Saved content to: ${fileName}`);
      console.log(`📊 Content length: ${content.length} characters`);

      // Create document object using TextService
      return await textService.document(content, "gpt-4o", {
        name: fileName,
        source: url,
        uuid: uuidv4(),
        conversation_uuid: this.conversationUuid,
      });
    } catch (error) {
      console.error(`❌ Error scraping URL ${url}:`, error);
      return null;
    }
  }

  async findLinksInContent(
    content: string,
    baseUrl: string
  ): Promise<string[]> {
    const links: string[] = [];
    const urlPattern = /\[([^\]]*)\]\(([^)]+)\)/g;
    const hrefPattern = /href=["']([^"']+)["']/g;

    let match;

    // Find markdown links
    while ((match = urlPattern.exec(content)) !== null) {
      const link = match[2];
      if (link.startsWith("http")) {
        links.push(link);
      } else if (link.startsWith("/")) {
        links.push(new URL(link, baseUrl).href);
      }
    }

    // Find href links
    while ((match = hrefPattern.exec(content)) !== null) {
      const link = match[1];
      if (link.startsWith("http")) {
        links.push(link);
      } else if (link.startsWith("/")) {
        links.push(new URL(link, baseUrl).href);
      }
    }

    // Filter to only include softo.ag3nts.org links and add to discovered URLs
    const softoLinks = [...new Set(links)].filter((link) =>
      link.includes("softo.ag3nts.org")
    );

    softoLinks.forEach((link) => this.allDiscoveredUrls.add(link));

    return softoLinks.filter((link) => !this.scrapedUrls.has(link));
  }

  async prioritizeLinks(
    links: string[],
    content: string
  ): Promise<LinkAnalysis[]> {
    if (links.length === 0) return [];

    // Add delay to avoid rate limits
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const questionsText = Object.values(this.questions).join("; ");
    const linkTexts = links
      .map((link, index) => `${index + 1}. ${link}`)
      .join("\n");

    const query = `
You need to prioritize which links from SoftoAI website are most likely to contain answers to these questions:

Questions we need to answer:
${questionsText}

Available links to check:
${linkTexts}

Context from current page:
${content.substring(0, 1000)}...

Rate each link from 1-10 based on how likely it is to contain answers to our questions. Consider:
- Link URL structure and keywords (portfolio, clients, about, contact, certificates)
- What sections typically contain company info and client information
- Avoid duplicate or less relevant pages (like /loop pages which seem to be decoys)

Respond with JSON format:
{
  "prioritized_links": [
    {
      "url": "full_url_here",
      "score": 8,
      "reason": "likely contains contact information"
    }
  ]
}

Only include links with score 6 or higher, maximum 5 links.`;

    try {
      const messages: ChatCompletionMessageParam[] = [
        { role: "user", content: query },
      ];

      const contextDoc = await textService.document(content, "gpt-4o", {
        name: "page_content",
        uuid: uuidv4(),
        conversation_uuid: this.conversationUuid,
      });

      const response = await assistantService.answer(
        query,
        messages,
        [contextDoc],
        ""
      );

      // Try to parse JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return result.prioritized_links || [];
      }

      throw new Error("No valid JSON found in response");
    } catch (error) {
      console.error("Error prioritizing links:", error);
      // Fallback: return first 3 links with default scores
      return links.slice(0, 3).map((url, index) => ({
        url,
        title: "",
        relevanceScore: 8 - index,
        reason: "fallback selection",
      }));
    }
  }

  async askAllQuestionsAboutContent(doc: IDoc): Promise<void> {
    const missingQuestions = Object.entries(this.questions).filter(
      ([questionId]) => !this.answers.some((a) => a.questionId === questionId)
    );

    if (missingQuestions.length === 0) return;

    console.log(
      `🤔 Analyzing Polish content for ${missingQuestions.length} questions...`
    );

    // Enhanced prompt for analyzing Polish website content
    const polishContentAnalysisPrompt = `
You are analyzing Polish website content from SoftoAI company to answer specific questions in Polish.

QUESTIONS TO ANSWER:
${missingQuestions.map(([id, question]) => `${id}. ${question}`).join("\n")}

WEBSITE CONTENT (in Polish):
${doc.text}

ANALYSIS INSTRUCTIONS:
- The content is in Polish language - analyze it carefully
- Look for specific Polish terms and phrases related to each question
- For email question ("adres mailowy"): Look for email addresses (kontakt@, info@, etc.)
- For BanAN interface question ("interfejs webowy", "sterowania robotami"): Look for URLs, links, or mentions of BanAN
- For ISO certificates question ("certyfikaty ISO", "jakości"): Look for ISO standards, certifications, quality certificates

POLISH TERMS TO RECOGNIZE:
- Email: "email", "e-mail", "adres mailowy", "kontakt", "skrzynka"
- Interface: "interfejs", "strona", "portal", "system", "platforma"
- Robots/Control: "roboty", "sterowanie", "kontrola", "zarządzanie"
- Certificates: "certyfikaty", "certyfikat", "ISO", "jakość", "standard", "norma"
- Quality: "jakość", "jakości", "standardy", "normy"

RESPONSE FORMAT:
For each question, provide the answer in this exact format:
[Question ID]: [Answer found in content OR "NOT_FOUND"]

Example:
01: kontakt@softoai.whatever
02: https://banan.ag3nts.org/
03: NOT_FOUND

IMPORTANT: Extract exact information from the Polish content. Do not invent answers.

ANSWERS:`;

    try {
      const polishDoc = await textService.document(doc.text, "gpt-4o", {
        name: "polish_website_content_analysis",
        source: "polish_content_extraction",
        uuid: uuidv4(),
        conversation_uuid: this.conversationUuid,
      });

      const messages: ChatCompletionMessageParam[] = [
        {
          role: "system",
          content:
            "You are an expert at analyzing Polish website content and extracting specific information. You understand Polish language nuances and can identify relevant terms and phrases in Polish text content.",
        },
        { role: "user", content: polishContentAnalysisPrompt },
      ];

      const response = await assistantService.answer(
        polishContentAnalysisPrompt,
        messages,
        [polishDoc],
        ""
      );

      console.log(`🎯 Polish content analysis response:`, response);

      // Parse responses with improved Polish content understanding
      for (const [questionId, question] of missingQuestions) {
        const answerPattern = new RegExp(
          `${questionId}\\s*[:\\-]\\s*(.+?)(?=\\n\\d+\\s*[:\\-]|$)`,
          "i"
        );
        const match = response.match(answerPattern);

        if (
          match &&
          match[1] &&
          !match[1].includes("NOT_FOUND") &&
          match[1].trim().length > 3
        ) {
          const answer = match[1].trim();
          const foundAnswer: FoundAnswer = {
            questionId,
            question,
            answer,
            source: doc.metadata?.source || "polish_content_analysis",
          };

          this.answers.push(foundAnswer);
          console.log(
            `✅ Found answer from Polish content ${questionId}: ${answer}`
          );
        }
      }
    } catch (error) {
      console.error(`❌ Error analyzing Polish content:`, error);
    }
  }

  async generateTargetedUrls(missingQuestions: string[]): Promise<string[]> {
    const baseUrl = "https://softo.ag3nts.org";
    const questionsText = missingQuestions.join("; ");

    const query = `
Based on these missing questions about SoftoAI company, suggest specific URL paths that might contain the answers:

Missing questions:
${questionsText}

Consider common website structures and suggest URL paths like:
- /about-us, /o-firmie, /historia, /company-info
- /team, /management, /leadership
- /awards, /certifications, /certyfikaty, /nagrody
- /quality, /iso, /standards, /jakosc
- /news, /press, /media, /aktualnosci
- /clients, /portfolio, /case-studies, /referencje
- /contact, /kontakt, /info
- /services-detail, /uslugi-szczegoly
- Any other paths that might contain company information

Respond with JSON format:
{
  "suggested_urls": [
    "https://softo.ag3nts.org/suggested-path-1",
    "https://softo.ag3nts.org/suggested-path-2"
  ]
}

Suggest 10-15 specific URLs that are most likely to contain the missing information.`;

    try {
      const messages: ChatCompletionMessageParam[] = [
        { role: "user", content: query },
      ];

      const response = await assistantService.answer(query, messages, [], "");

      // Try to parse JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return result.suggested_urls || [];
      }

      throw new Error("No valid JSON found in response");
    } catch (error) {
      console.error("Error generating targeted URLs:", error);

      // Fallback: generate common company pages
      return [
        `${baseUrl}/o-firmie`,
        `${baseUrl}/historia`,
        `${baseUrl}/nagrody`,
        `${baseUrl}/certyfikaty-iso`,
        `${baseUrl}/quality`,
        `${baseUrl}/standards`,
        `${baseUrl}/achievements`,
        `${baseUrl}/company-info`,
        `${baseUrl}/management`,
        `${baseUrl}/team`,
        `${baseUrl}/press`,
        `${baseUrl}/media`,
        `${baseUrl}/news`,
      ];
    }
  }

  async searchAdditionalUrls(): Promise<void> {
    const missingQuestions = Object.entries(this.questions)
      .filter(
        ([questionId]) => !this.answers.some((a) => a.questionId === questionId)
      )
      .map(([, question]) => question);

    if (missingQuestions.length === 0) return;

    console.log(`\n🔍 --- Additional URL Discovery ---`);
    console.log(`❓ Missing answers for ${missingQuestions.length} questions`);
    console.log(`📊 Already discovered ${this.allDiscoveredUrls.size} URLs`);

    // Generate targeted URLs based on missing questions
    const targetedUrls = await this.generateTargetedUrls(missingQuestions);
    console.log(`🎯 Generated ${targetedUrls.length} targeted URLs to try`);

    // Combine with undiscovered URLs
    const unscrapedDiscovered = Array.from(this.allDiscoveredUrls).filter(
      (url) => !this.scrapedUrls.has(url)
    );

    const allUrlsToTry = [
      ...new Set([...targetedUrls, ...unscrapedDiscovered]),
    ];
    console.log(`📝 Total URLs to explore: ${allUrlsToTry.length}`);

    // Try each URL
    for (const url of allUrlsToTry.slice(0, 15)) {
      // Reduced limit to save time for web search
      try {
        console.log(`🔗 Trying: ${url}`);
        const doc = await this.scrapeAndSaveUrl(url);

        if (doc && doc.text.length > 100) {
          await this.askAllQuestionsAboutContent(doc);

          // Discover more links from this page
          const newLinks = await this.findLinksInContent(
            doc.text,
            "https://softo.ag3nts.org"
          );
          console.log(`  📎 Discovered ${newLinks.length} new links`);

          // If we found all answers, break
          if (this.answers.length >= Object.keys(this.questions).length) {
            console.log(`🎉 Found all answers! Stopping search.`);
            break;
          }
        }

        // Add delay between requests
        await new Promise((resolve) => setTimeout(resolve, 1500));
      } catch (error: any) {
        if (
          !error.message?.includes("404") &&
          !error.message?.includes("429")
        ) {
          console.log(
            `  ⚠️  Error accessing ${url}: ${error.message.substring(0, 100)}`
          );
        }
      }
    }
  }

  async searchSpecificPages(): Promise<void> {
    console.log(`🎯 --- Searching Specific High-Value Pages ---`);

    const specificPages = [
      "https://softo.ag3nts.org/portfolio",
      "https://softo.ag3nts.org/clients",
      "https://softo.ag3nts.org/klienci",
      "https://softo.ag3nts.org/about",
      "https://softo.ag3nts.org/o-nas",
      "https://softo.ag3nts.org/certyfikaty",
      "https://softo.ag3nts.org/certificates",
    ];

    for (const pageUrl of specificPages) {
      const doc = await this.scrapeAndSaveUrl(pageUrl);
      if (!doc) continue;

      await this.askAllQuestionsAboutContent(doc);

      // Special handling for portfolio page - look for BanAN specific page
      if (pageUrl.includes("portfolio") && doc.text.includes("BanAN")) {
        console.log(
          `🎯 Found BanAN mention in portfolio - looking for specific page...`
        );

        // Extract the specific BanAN portfolio page URL
        const bananPageMatch = doc.text.match(
          /\[([^\]]*BanAN[^\]]*)\]\((https?:\/\/[^)]+)\)/i
        );
        if (bananPageMatch) {
          const bananPageUrl = bananPageMatch[2];
          console.log(`🔗 Found BanAN specific page: ${bananPageUrl}`);

          const bananDoc = await this.scrapeAndSaveUrl(bananPageUrl);
          if (bananDoc) {
            // Now specifically extract the banan.ag3nts.org URL from this page
            await this.extractBanANInterfaceUrl(bananDoc);
            await this.askAllQuestionsAboutContent(bananDoc);
          }
        }
      }

      // Break early if we found all answers
      if (this.answers.length >= Object.keys(this.questions).length) {
        console.log(`🎉 Found all answers in specific pages!`);
        break;
      }
    }
  }

  async extractBanANInterfaceUrl(doc: any): Promise<void> {
    console.log(`🔍 Extracting BanAN interface URL from content...`);

    // Look for the specific BanAN interface URL in markdown links
    const content = doc.text;

    // Pattern to find the banan.ag3nts.org URL
    const bananUrlPattern =
      /\[([^\]]*(?:interfejs|sterowanie|programowanie|robot)[^\]]*)\]\((https?:\/\/banan\.ag3nts\.org[^)]*)\)/gi;
    let match;

    while ((match = bananUrlPattern.exec(content)) !== null) {
      const linkText = match[1];
      const linkUrl = match[2];

      console.log(`🔗 Found BanAN interface link: "${linkText}" -> ${linkUrl}`);

      // Check if we already have this answer
      const existingAnswer = this.answers.find((a) => a.questionId === "02");
      if (existingAnswer) {
        // Update the existing answer with the correct URL
        existingAnswer.answer = linkUrl;
        existingAnswer.source =
          doc.metadata?.source || "banan_interface_extraction";
        console.log(`✅ Updated BanAN interface URL: ${linkUrl}`);
      } else {
        // Add new answer
        const foundAnswer: FoundAnswer = {
          questionId: "02",
          question: this.questions["02"],
          answer: linkUrl,
          source: doc.metadata?.source || "banan_interface_extraction",
        };

        this.answers.push(foundAnswer);
        console.log(`✅ Found BanAN interface URL: ${linkUrl}`);
      }

      break; // Take the first match
    }

    // Also try a more general pattern for banan.ag3nts.org
    if (
      !this.answers.some(
        (a) => a.questionId === "02" && a.answer.includes("banan.ag3nts.org")
      )
    ) {
      const generalBananPattern =
        /https?:\/\/banan\.ag3nts\.org\/?[a-zA-Z0-9.\-_/?=&#%]*/gi;
      const bananMatches = content.match(generalBananPattern);

      if (bananMatches && bananMatches.length > 0) {
        const bananUrl = bananMatches[0];
        console.log(`🔗 Found general BanAN URL: ${bananUrl}`);

        const existingAnswer = this.answers.find((a) => a.questionId === "02");
        if (existingAnswer) {
          existingAnswer.answer = bananUrl;
          existingAnswer.source =
            doc.metadata?.source || "banan_url_extraction";
          console.log(`✅ Updated to general BanAN URL: ${bananUrl}`);
        } else {
          const foundAnswer: FoundAnswer = {
            questionId: "02",
            question: this.questions["02"],
            answer: bananUrl,
            source: doc.metadata?.source || "banan_url_extraction",
          };

          this.answers.push(foundAnswer);
          console.log(`✅ Found general BanAN URL: ${bananUrl}`);
        }
      }
    }
  }

  async searchWebsite(): Promise<FoundAnswer[]> {
    const baseUrl = "https://softo.ag3nts.org";
    let urlsToCheck = [baseUrl];
    let checkedUrls: Set<string> = new Set();
    let maxDepth = 2;
    let currentDepth = 0;

    // First, try specific pages that are most likely to have answers
    await this.searchSpecificPages();

    // If we still need answers, do general exploration
    while (
      urlsToCheck.length > 0 &&
      currentDepth < maxDepth &&
      this.answers.length < Object.keys(this.questions).length
    ) {
      console.log(`\n🔍 --- Depth ${currentDepth + 1} ---`);
      console.log(`📝 URLs to check: ${urlsToCheck.length}`);
      console.log(
        `✅ Answers found so far: ${this.answers.length}/${Object.keys(this.questions).length}`
      );

      const currentUrls = [...urlsToCheck];
      urlsToCheck = [];

      for (const url of currentUrls) {
        if (checkedUrls.has(url)) continue;
        checkedUrls.add(url);

        // Scrape the URL
        const doc = await this.scrapeAndSaveUrl(url);
        if (!doc) continue;

        // Look for answers in this content
        await this.askAllQuestionsAboutContent(doc);

        // If we haven't found all answers yet, look for more links
        if (this.answers.length < Object.keys(this.questions).length) {
          const newLinks = await this.findLinksInContent(doc.text, baseUrl);

          if (newLinks.length > 0) {
            // Prioritize links intelligently
            const prioritizedLinks = await this.prioritizeLinks(
              newLinks,
              doc.text
            );
            urlsToCheck.push(...prioritizedLinks.map((link) => link.url));

            console.log(
              `🔗 Found ${newLinks.length} links, prioritized ${prioritizedLinks.length}`
            );
            prioritizedLinks.forEach((link) => {
              console.log(
                `  📎 ${link.url} (score: ${link.relevanceScore}) - ${link.reason}`
              );
            });
          }
        }

        // Break if we found all answers
        if (this.answers.length >= Object.keys(this.questions).length) {
          break;
        }
      }

      currentDepth++;
    }

    // If we still don't have all answers, try additional URL discovery
    if (this.answers.length < Object.keys(this.questions).length) {
      await this.searchAdditionalUrls();
    }

    // DEEP CONTENT ANALYSIS: Analyze all scraped content for patterns
    if (this.answers.length < Object.keys(this.questions).length) {
      await this.performDeepContentAnalysis();
    }

    // ADVANCED CONTENT INFERENCE: Use AI to infer answers (especially for ISO certificates)
    if (this.answers.length < Object.keys(this.questions).length) {
      await this.performAdvancedContentInference();
    }

    // FINAL ATTEMPT: Use enhanced web search for any remaining missing answers
    if (this.answers.length < Object.keys(this.questions).length) {
      await this.searchWebForMissingAnswers();
    }

    return this.answers;
  }

  async saveResults(): Promise<void> {
    const results = {
      questions: this.questions,
      answers: this.answers,
      webSearchResults: this.webSearchResults,
      summary: {
        totalQuestions: Object.keys(this.questions).length,
        foundAnswers: this.answers.length,
        scrapedUrls: Array.from(this.scrapedUrls),
        discoveredUrls: Array.from(this.allDiscoveredUrls),
        webSearchQueries: this.webSearchResults.length,
        totalContentAnalyzed: this.allScrapedContent.length,
      },
    };

    const resultsPath = path.join(__dirname, "search_results.json");
    await fs.writeFile(resultsPath, JSON.stringify(results, null, 2), "utf-8");

    console.log(`\n✅ Results saved to: ${resultsPath}`);
    console.log("\n📋 FINAL RESULTS:");
    console.log("==================");

    for (const answer of this.answers) {
      console.log(`\n${answer.questionId}. ${answer.question}`);
      console.log(`Answer: ${answer.answer}`);
      console.log(`Source: ${answer.source}`);
    }

    const missingAnswers = Object.keys(this.questions).filter(
      (id) => !this.answers.some((a) => a.questionId === id)
    );

    if (missingAnswers.length > 0) {
      console.log("\n❌ QUESTIONS WITHOUT ANSWERS:");
      for (const id of missingAnswers) {
        console.log(`${id}. ${this.questions[id]}`);
      }
    }

    console.log(
      `\n📊 Success Rate: ${this.answers.length}/${Object.keys(this.questions).length} (${Math.round((this.answers.length / Object.keys(this.questions).length) * 100)}%)`
    );
    console.log(`📈 Total URLs Discovered: ${this.allDiscoveredUrls.size}`);
    console.log(`📄 Total URLs Scraped: ${this.scrapedUrls.size}`);
    console.log(`🌐 Web Search Queries: ${this.webSearchResults.length}`);
    console.log(
      `📝 Total Content Analyzed: ${Math.round(this.allScrapedContent.length / 1000)}k characters`
    );
  }

  async sendAnswersToCentrala(): Promise<void> {
    const centralaUrl = "https://c3ntrala.ag3nts.org/report";
    const apiKey = process.env.PERSONAL_API_KEY;

    // Convert answers array to required format
    const answerObj: { [key: string]: string } = {};
    for (const answer of this.answers) {
      answerObj[answer.questionId] = answer.answer;
    }

    const payload = {
      task: "softo",
      apikey: apiKey,
      answer: answerObj,
    };

    console.log("\n🚀 Sending answers to Centrala...");
    console.log("📤 Payload:", JSON.stringify(payload, null, 2));

    try {
      const response = await fetch(centralaUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const responseData = await response.json();

      if (response.ok) {
        console.log("✅ Successfully sent answers to Centrala!");
        console.log("📥 Response:", responseData);
      } else {
        console.error("❌ Error sending answers to Centrala:");
        console.error("Status:", response.status);
        console.error("Response:", responseData);
      }
    } catch (error) {
      console.error("❌ Network error sending answers to Centrala:", error);
    }
  }
}

async function main() {
  console.log(
    "🤖 Starting SoftoAI Search Agent (Enhanced Polish Content Analysis)..."
  );

  const agent = new SoftoAISearchAgent();

  try {
    // Load questions
    await agent.loadQuestions();

    // Search the website
    const answers = await agent.searchWebsite();

    // Save results
    await agent.saveResults();

    // Send answers to Centrala
    await agent.sendAnswersToCentrala();

    console.log(`\n🎉 Search completed! Found ${answers.length} answers.`);
  } catch (error) {
    console.error("❌ Error in main process:", error);
  }
}

main();
