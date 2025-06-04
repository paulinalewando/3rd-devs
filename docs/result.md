We already have several ready-made elements that allow for connecting LLM with external data in the form of files submitted as URLs or paths to files saved on a disk. Besides, we discussed an example of a `websearch`, which allowed us to connect a model with the Internet simply.

The thing is, data sources can have another nature as well. Examples include information from the environment (location, apps running on a phone, current weather, or music currently playing). Some of these can be obtained in real time, while others will be updated cyclically and loaded only as needed. We are talking here about situations where data does not come from the user but is programmatically retrieved, and our system has the right to load them when necessary.

The last example of data is also those provided by the user or other AI agents **during interaction**. For instance, during a longer conversation, building a conversation context is advisable, which is not entirely delivered to the system prompt.

In all this, there is still a lack of possibilities for **creating content** and **saving files**. We have already seen several examples of this in previous AI_devs weeks, but now we will combine them into tools the model will use.
## Logic Overview

In this lesson, we will discuss the example of `web`, which combines the logic of examples such as `loader`, `summary`, `translate`, `websearch`, `hybrid`, and others. This time, however, the responsibility for operating the tools will largely shift into the hands of the model, although the available logic will still have a quite linear character and does not offer much room for 'model creativity'.

Below we see a message exchange where I was asked to fetch content from three PDF files containing invoices, load the specified information, and deliver me the result as a link to a .csv file.

It's easy to imagine that such commands can be automatically sent, e.g., with links to email attachments marked with a chosen label. Data sources could also be photos from our phone or files uploaded to Dropbox.

However, that's not the end of it, because different tool selection combinations allow for sending a **long file** with a request for translation while preserving full formatting. As you can see, the translation was carried out correctly despite exceeding the "output tokens" limit.

And finally, we also have the possibility of downloading selected website contents, which can also be executed by scripts and automations working for us in the background.

The example's logic is, therefore, to:

- Understand the user's query and form a plan based on it
- Execute individual steps, with the possibility of passing context between them. So if the first step is 'browsing the Internet', its result will be available in later stages
- Among the available actions, there is also the option to upload a file to the server and generate a direct link for it
- After completing all the steps, the model generates the final response.

However, the whole is not ready for every possible scenario and is intended to work for repetitive tasks such as document processing or cyclical Internet information retrieval.

**IMPORTANT:** The `web` example logic can handle the following situations:

- Load `link_to_file` and translate it from Polish to English and provide me with a link to the finished document
- Download AI entries from `https://news.ycombinator.com/newest`
- Summarize this document: `link`
- Go to `blog` and download today's articles (if there are any)
- Go to `blog`, download today's articles (if there are any), and summarize them for me

We are, therefore, talking about simple messages that can include processing several sources and passing information between stages.
## File Uploading and Creation

Language models have no major problems with generating content for text documents. Markdown, JSON, or CSV can also be programmatically converted into binary formats such as PDF, docx, or xlsx. However, placing the file on disk and generating a link to it must take the form of a tool.

In practice, we will need two ways of creating files. One will be available to the user, and the other to LLM. For this reason, in the `web` example, I created the `/api/upload` endpoint. Although we will not use it now, it’s worth noting a few things:

- The file is **loaded as a document** and saved in the database
- The file's metadata includes a conversation identifier
- The response returns information about the file, including the URL that LLM can use.

**Important:** for production implementations of such solutions, ensure that:

- We check the `mimeType` of the uploaded file and reject those that do not comply with supported formats
- Besides the file type, we should also check its size
- The link pointing to the file should require authentication, e.g., an API key or an active user session

Such an endpoint allows us to upload files to the application and use them later during the conversation based on the `conversation_uuid`.

Creating a file with the help of LLM is more complex because we must also include **writing the content**. In the `web` example, the model can save files whose content is written "manually" by it. However, it may happen that the saved file must be a **previously generated translation**. In such a case, we want to **avoid rewriting the document**, especially since due to the limit of output token windows, we may not have that possibility. I thus use a known 'trick' with `[[uuid]]`, indicating documents in the context that are replaced with appropriate content.

Exactly the same possibility functions in responses sent to the user. In the image below, we see a fragment of the system prompt that contains a `documents` section with an entry of the content of a previous statement in the form of a list of tools.

On the front end, we see **exactly the same content**, which originally read: "Here is the extracted list of hardware\n\n`[[ff7a079b-6299-4833-bf75-5e2c6fe57fba]]`", whereas the placeholder was programmatically replaced with the previously loaded document.

Thus, file creation in the case of LLM relies solely on generating a name and indicating identifiers to be loaded as content. Optionally, the model can include additional formatting for this content and its comments.
## Planning

Using tools by LLM involves combining two elements: a programmatic interface and prompts. The logic itself can have a more linear nature, which we have seen many times, or agency character, capable of going beyond the established framework and solving open-ended problems.

This time we are interested in this "middle" scenario, where a model equipped with a series of tools can use them in any order and number of steps. However, it cannot change an established plan or return to previous stages. Besides, the system itself is not resistant to 'unforeseen' scenarios, so user commands should be precise. For this reason, it is not suitable for us in such a form productively, but it can work 'in the background' and save the effects of its work in the database or send them by email.

Such a restriction naturally results in the problem of **limited initial knowledge**. Therefore, we cannot immediately generate all the parameters needed to run the necessary tools. Instead, we can establish a list of steps and write notes or queries with them, which are commands the model generates 'for itself'. The only condition here is maintaining the order of actions.

From lesson S04E01 — Interface, we know that tools must have unique names and usage instructions. Now we find it won’t always be obvious, because they may have different complexities and subcategories. For instance, `file_process`, responsible for processing documents, currently has 5 different types. Their descriptions are not needed at the initial planning stage but only when a given type is selected.

Until LLMs have greater attention-keeping capabilities (perhaps thanks to [Differential Transformer](https://www.microsoft.com/en-us/research/publication/differential-transformer/)), the planning and action-taking process must be divided into small, specialized prompts. The challenge is only to deliver all the data needed to undertake further actions at a given stage without adding unnecessary 'noise'.
## Conversation Context Basics

The `web` example saves all content in a database in the form of documents, which we discussed in lesson S03E01. Each entry is linked to the current conversation and can optionally be added to search engines. This allows us not only to later use these documents as context but also to use them flexibly within an ongoing interaction.

Below we see one such record, whose main content is only the product price loaded from an invoice. However, in the metadata, there is a context-providing **information** about what exactly these numbers are and where they originate.

Information stored this way can be brought into the system prompt context at any time with information about its origin and where more details about it can be found.

This is precisely how we will save data from external sources and then load them into a conversation as a "state," which serves as the model's "short-term memory." For one of my projects, the state includes:

- **context** (available skills, environmental information, list of actions taken, loaded documents, conversation summaries, discussed keywords, or loaded memories),
- **reasoning-related information** (current status, available steps, current action plan, reflections on it and active tool)
- **information about the conversation**: interaction ID (for LangFuse purposes), conversation ID, list of messages, and related settings

In other words, when thinking about the conversation context, we will be referring to the combination of three things: **knowledge from the ongoing interaction**, **knowledge from long-term memory**, and **variables controlling logic on the programming side**.

The conversation context is a crucial element of agent systems because it allows for more complex task execution. Even our `web` example, despite its assumptions' limitations, is capable of using a simple context that enables information passing between individual stages.

Below we see that the user did not provide the article's content as a URL but only indicated the place from which it should be fetched.

The assistant correctly broke this task into smaller steps and appropriately used the available context, passing it between stages.

## Summary

The logic of browsing websites in the `web` example relies on **generating a list of search engine queries** and **deciding which sites' content should be retrieved**. The process can be shortened to just retrieving content from a specified URL.

However, tools such as Code Interpreter (e.g., e2b), [BrowserBase](https://www.browserbase.com/), or probably known to you, [Playwright](https://playwright.dev/) or [Puppeteer](https://pptr.dev/) exist. Specifically, we are talking about automation involving running generated code and combining text and image understanding capabilities for dynamic actions.

Although examples are emerging online showing autonomous research and Internet browsing capabilities for information gathering, **it’s currently hard to talk about high effectiveness without imposing restrictions.** Even web scraping does not allow for unrestrained browsing of any site and should be configured to access selected addresses or rely on external solutions like [apify](https://apify.com/).
The `web` example shows us that an LLM equipped with tools and the mechanics of building and using context can independently perform complex tasks without human involvement. However, a necessary condition (at least for now) is to precisely define what is available to the model and what is not. Otherwise, problems quickly arise, either related to the model's capabilities or barriers stemming from the technology itself (e.g., the necessity of logging into a website).