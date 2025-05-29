# Exercise 13 - Document Embedding with Date Metadata

This application processes all `.txt` files in the `do-not-share` folder, creates embeddings for each document, and stores them in a Qdrant vector database with date metadata extracted from the filename.

## Features

- **Automatic file processing**: Reads all `.txt` files from `do-not-share/` directory
- **Date extraction**: Extracts dates from filenames in format `YYYY_MM_DD.txt` and converts to `YYYY-MM-DD`
- **Embedding creation**: Uses Jina AI embeddings (1024-dimensional) for semantic search
- **Vector storage**: Stores embeddings in Qdrant collection with metadata
- **Search functionality**: Includes example search capability to test embeddings

## Setup

1. **Environment Variables**: Create a `.env` file in the project root with:

   ```
   OPENAI_API_KEY=your_openai_api_key_here
   JINA_API_KEY=your_jina_api_key_here
   QDRANT_URL=http://localhost:6333
   QDRANT_API_KEY=your_qdrant_api_key_or_leave_empty_for_local
   ```

2. **Qdrant Database**: Make sure Qdrant is running:
   ```bash
   # Using Docker
   docker run -p 6333:6333 qdrant/qdrant
   ```

## Usage

Run the application from the project root:

```bash
# Using npm/yarn script
npm run exercise13

# Or directly with bun
bun run exercise13/app.ts
```

## What the Application Does

1. **Scans files**: Finds all `.txt` files in `do-not-share/` directory
2. **Extracts dates**: Converts filenames like `2024_03_15.txt` to date metadata `2024-03-15`
3. **Creates embeddings**: Generates 1024-dimensional embeddings using Jina AI
4. **Stores in Qdrant**: Saves embeddings with metadata in the `documents` collection
5. **Tests search**: Demonstrates search functionality with a sample query

## File Structure

- `app.ts` - Main application with `EmbeddingProcessor` class
- `VectorService.ts` - Qdrant vector database operations
- `OpenAIService.ts` - AI model interactions (OpenAI + Jina AI)
- `TextService.ts` - Text processing utilities
- `do-not-share/` - Directory containing the source `.txt` files

## Metadata Structure

Each document is stored with the following metadata:

- `filename` - Original filename
- `date` - Extracted date in YYYY-MM-DD format
- `originalPath` - Path to the original file
- `processedAt` - Timestamp when the document was processed

## Example Output

```
Starting embedding process...
Found 23 txt files to process
Processing file: 2024_01_08.txt
✓ Prepared embedding data for 2024_01_08.txt (date: 2024-01-08)
...
✅ Successfully processed 23 files
Embeddings created and stored in Qdrant collection

📊 Processing Summary:
  - 2024_01_08.txt: 2024-01-08
  - 2024_01_17.txt: 2024-01-17
  ...
```

## Search Example

The application includes a search test that queries for "broń plazma" and returns the most relevant documents with their scores, dates, and content previews.
