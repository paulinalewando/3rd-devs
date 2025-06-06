import FirecrawlApp from "@mendable/firecrawl-js";
import { OpenAIService } from "./OpenAIService";
import { prompt as useSearchPrompt } from "./prompts/web/useSearch";
import { prompt as askDomainsPrompt } from "./prompts/web/askDomains";
import { prompt as selectResourcesToLoadPrompt } from "./prompts/web/pickResources";
import { TextService } from "./TextService";
import { v4 as uuidv4 } from "uuid";
import type {
  AllowedDomain,
  Query,
  SearchResult,
  WebContent,
} from "./types/types";
import type { IDoc } from "./types/types";

import type {
  ChatCompletion,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";

export class WebSearchService {
  private openaiService: OpenAIService;
  private textService: TextService;
  private allowedDomains: AllowedDomain[];
  private apiKey: string;
  private firecrawlApp: FirecrawlApp;

  constructor() {
    this.openaiService = new OpenAIService();
    this.textService = new TextService();
    this.allowedDomains = [
      { name: "Wikipedia", url: "wikipedia.org", scrappable: true },
      { name: "easycart", url: "easy.tools", scrappable: true },
      { name: "FS.blog", url: "fs.blog", scrappable: true },
      { name: "arXiv", url: "arxiv.org", scrappable: true },
      { name: "Instagram", url: "instagram.com", scrappable: false },
      { name: "OpenAI", url: "openai.com", scrappable: true },
      { name: "Brain overment", url: "brain.overment.com", scrappable: true },
      { name: "Reuters", url: "reuters.com", scrappable: true },
      {
        name: "MIT Technology Review",
        url: "technologyreview.com",
        scrappable: true,
      },
      { name: "Youtube", url: "youtube.com", scrappable: false },
      { name: "Mrugalski / UWteam", url: "mrugalski.pl", scrappable: true },
      { name: "overment", url: "brain.overment.com", scrappable: true },
      { name: "Hacker News", url: "news.ycombinator.com", scrappable: true },
      { name: "IMDB", url: "imdb.com", scrappable: true },
      { name: "TechCrunch", url: "techcrunch.com", scrappable: true },
      {
        name: "Hacker News Newest",
        url: "https://news.ycombinator.com/newest",
        scrappable: true,
      },
      {
        name: "TechCrunch Latest",
        url: "https://techcrunch.com/latest",
        scrappable: true,
      },
      { name: "OpenAI News", url: "https://openai.com/news", scrappable: true },
      {
        name: "Anthropic News",
        url: "https://www.anthropic.com/news",
        scrappable: true,
      },
      {
        name: "DeepMind Press",
        url: "https://deepmind.google/about/press",
        scrappable: true,
      },
      {
        name: "SoftoAI",
        url: "https://softo.ag3nts.org",
        scrappable: true,
      },
    ];
    this.apiKey = process.env.FIRECRAWL_API_KEY || "";
    this.firecrawlApp = new FirecrawlApp({ apiKey: this.apiKey });
  }

  async isWebSearchNeeded(messages: ChatCompletionMessageParam[]) {
    const systemPrompt: ChatCompletionMessageParam = {
      role: "system",
      content: useSearchPrompt(),
    };

    const response = (await this.openaiService.completion({
      messages: [systemPrompt, ...messages],
      model: "gpt-4o",
      jsonMode: true,
    })) as ChatCompletion;
    if (response.choices[0].message.content) {
      return JSON.parse(response.choices[0].message.content);
    }
    return { shouldSearch: false };
  }

  async generateQueries(
    messages: ChatCompletionMessageParam[]
  ): Promise<{ queries: Query[]; thoughts: string }> {
    const systemPrompt: ChatCompletionMessageParam = {
      role: "system",
      content: askDomainsPrompt(this.allowedDomains),
    };

    try {
      const response = (await this.openaiService.completion({
        messages: [systemPrompt, ...messages],
        model: "gpt-4o",
        jsonMode: true,
      })) as ChatCompletion;

      const result = JSON.parse(response.choices[0].message.content as string);
      const filteredQueries = result.queries.filter(
        (query: { q: string; url: string }) =>
          this.allowedDomains.some((domain) => query.url.includes(domain.url))
      );
      // save documetn
      return { queries: filteredQueries, thoughts: result._thoughts };
    } catch (error) {
      console.error("Error generating queries:", error);
      return { queries: [], thoughts: "" };
    }
  }

  async searchWeb(
    queries: Query[],
    conversation_uuid?: string
  ): Promise<SearchResult[]> {
    const searchResults = await Promise.all(
      queries.map(async ({ q, url }) => {
        try {
          // Add site: prefix to the query using domain
          const domain = new URL(
            url.startsWith("https://") ? url : `https://${url}`
          );
          const siteQuery = `site:${domain.hostname.replace(/\/$/, "")} ${q}`;
          const response = await fetch("https://api.firecrawl.dev/v0/search", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
              query: siteQuery,
              searchOptions: {
                limit: 6,
              },
              pageOptions: {
                fetchPageContent: false,
              },
            }),
          });

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          const result = await response.json();

          if (result.success && result.data && Array.isArray(result.data)) {
            return {
              query: q,
              domain: domain.href,
              results: result.data.map((item: any) => ({
                url: item.url,
                title: item.title,
                description: item.description,
              })),
            };
          } else {
            console.warn(`No results found for query: "${siteQuery}"`);
            return { query: q, domain: domain.href, results: [] }; // Add domain here
          }
        } catch (error) {
          console.error(`Error searching for "${q}":`, error);
          return { query: q, domain: url, results: [] }; // Add domain here
        }
      })
    );

    return searchResults;
  }

  async selectResourcesToLoad(
    messages: ChatCompletionMessageParam[],
    filteredResults: SearchResult[]
  ): Promise<string[]> {
    const systemPrompt: ChatCompletionMessageParam = {
      role: "system",
      content: selectResourcesToLoadPrompt({ resources: filteredResults }),
    };

    try {
      const response = (await this.openaiService.completion({
        messages: [systemPrompt, ...messages],
        model: "gpt-4o",
        jsonMode: true,
      })) as ChatCompletion;

      if (response.choices[0].message.content) {
        const result = JSON.parse(response.choices[0].message.content);
        const selectedUrls = result.urls;

        console.log("selectedUrls", selectedUrls);
        // Filter out URLs that aren't in the filtered results
        const validUrls = selectedUrls.filter((url: string) =>
          filteredResults.some((r) =>
            r.results.some((item) => item.url === url)
          )
        );

        // Get domains with empty results
        const emptyDomains = filteredResults
          .filter((r) => r.results.length === 0)
          .map((r) => r.domain);

        // Combine validUrls and emptyDomains
        const combinedUrls = [...validUrls, ...emptyDomains];

        return combinedUrls;
      }

      throw new Error("Unexpected response format");
    } catch (error) {
      console.error("Error selecting resources to load:", error);
      return [];
    }
  }

  async scrapeUrls(
    urls: string[],
    conversation_uuid: string
  ): Promise<WebContent[]> {
    console.log("Input (scrapeUrls):", urls);

    // Filter out URLs that are not scrappable based on allowedDomains
    const scrappableUrls = urls.filter((url) => {
      const domain = new URL(url).hostname.replace(/^www\./, "");
      const allowedDomain = this.allowedDomains.find((d) => d.url === domain);
      return allowedDomain && allowedDomain.scrappable;
    });

    const scrapePromises = scrappableUrls.map(async (url) => {
      try {
        url = url.replace(/\/$/, "");

        const scrapeResult = await this.firecrawlApp.scrapeUrl(url, {
          formats: ["markdown"],
        });

        // @ts-ignore
        if (scrapeResult && scrapeResult.markdown) {
          // @ts-ignore
          return { url, content: scrapeResult.markdown.trim() };
        } else {
          console.warn(`No markdown content found for URL: ${url}`);
          return { url, content: "" };
        }
      } catch (error) {
        console.error(`Error scraping URL ${url}:`, error);
        return { url, content: "" };
      }
    });

    const scrapedResults = await Promise.all(scrapePromises);
    return scrapedResults.filter((result) => result.content !== "");
  }

  async search(query: string, conversation_uuid: string): Promise<IDoc[]> {
    const messages: ChatCompletionMessageParam[] = [
      { role: "user", content: query },
    ];
    const { queries } = await this.generateQueries(messages);

    console.table(
      queries.map((query, index) => ({
        "Query Number": index + 1,
        Query: query,
      }))
    );

    let docs: IDoc[] = [];

    if (queries.length > 0) {
      const searchResults = await this.searchWeb(queries, conversation_uuid);
      const resources = await this.selectResourcesToLoad(
        messages,
        searchResults
      );
      const scrapedContent = await this.scrapeUrls(
        resources,
        conversation_uuid
      );

      docs = await Promise.all(
        searchResults.flatMap((searchResult) =>
          searchResult.results.map(async (result) => {
            const scrapedItem = scrapedContent.find(
              (item) => item.url === result.url
            );
            const content = scrapedItem
              ? scrapedItem.content
              : result.description;

            const doc = await this.textService.document(content, "gpt-4o", {
              name: `${result.title}`,
              description: `This is a result of a web search for the query: "${searchResult.query}"`,
              source: result.url,
              content_type: scrapedItem ? "complete" : "chunk",
              uuid: uuidv4(),
              conversation_uuid,
            });

            return doc;
          })
        )
      );
    }

    return docs;
  }
}
