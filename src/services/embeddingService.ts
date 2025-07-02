import { GoogleGenAI } from '@google/genai';
import { log, logVerbose } from '../logger';
import { CredentialsManager } from './credentialsManager';
import { CodeChunk } from './codeChunker';
import path = require('path');

export class EmbeddingService {
  private readonly EMBEDDING_MODEL = 'gemini-embedding-exp-03-07'; // Update as needed
  private readonly MAX_BATCH_SIZE = 10; // Maximum number of chunks to embed at once
  private readonly MAX_RETRY_ATTEMPTS = 3;
  private readonly RETRY_BACKOFF_BASE_MS = 10000;
  private readonly THROTTLE_DELAY_MS = 5000;
  private credentialsManager: CredentialsManager;
  private aiClient: GoogleGenAI | null = null;
  private embeddingDimension?: number = 3072;

  // Caching to avoid redundant embedding generation
  private embeddingCache: Map<string, number[]> = new Map();

  constructor(credentialsManager: CredentialsManager) {
    this.credentialsManager = credentialsManager;
    this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      let apiKey = await this.credentialsManager.getGeminiApiKey();

      if (!apiKey) {
        log('Gemini API key not found. Prompting for credentials.');
        const got = await this.credentialsManager.promptForCredentials();
        if (!got) throw new Error('Gemini API key required');
        const newKey = await this.credentialsManager.getGeminiApiKey();
        if (!newKey) throw new Error('Gemini API key required');
        apiKey = newKey;
      }

      const validKey = apiKey;
      this.aiClient = new GoogleGenAI({ apiKey: validKey });

      log('GenAI Embedding service initialized successfully');
    } catch (error) {
      if (error instanceof Error && /401|Unauthorized/.test(error.message)) {
        const got = await this.credentialsManager.promptForCredentials();
        if (!got) throw error;
        return this.initialize();
      }
      log(`Error initializing GenAI Embedding service: ${error}`);
      throw new Error(`Failed to initialize GenAI Embedding service: ${error}`);
    }
  }

  /**
   * Set desired embedding output dimension. Results will be truncated or zero-padded.
   */
  public setEmbeddingDimension(dim: number): void {
    this.embeddingDimension = dim;
  }

  /**
   * Embeds a single code chunk
   */
  async embedCodeChunk(chunk: CodeChunk): Promise<number[]> {
    // Check cache first
    if (this.embeddingCache.has(chunk.id)) {
      logVerbose(`Using cached embedding for chunk ${chunk.id}`);
      return this.embeddingCache.get(chunk.id) ?? [];
    }

    const client = await this.ensureInitialized();

    for (let attempt = 1; attempt <= this.MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        // Format the content to include metadata for better embeddings
        const formattedContent = this.formatChunkForEmbedding(chunk);

        const response = await client.models.embedContent({
          model: this.EMBEDDING_MODEL,
          contents: [formattedContent],
          config:
            this.embeddingDimension != null
              ? { outputDimensionality: this.embeddingDimension }
              : undefined,
        });

        const embedding = response.embeddings?.[0]?.values ?? [];

        // Cache and throttle
        this.embeddingCache.set(chunk.id, embedding);
        await this.delay(this.THROTTLE_DELAY_MS);
        return embedding;
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        if (attempt < this.MAX_RETRY_ATTEMPTS && errMsg.includes('429')) {
          log(
            `Rate limit hit embedding chunk ${chunk.id}, retry #${attempt} after backoff`,
          );
          await this.delay(this.RETRY_BACKOFF_BASE_MS * attempt);
          continue;
        }
        log(`Error embedding code chunk ${chunk.id}: ${errMsg}`);
        throw new Error(`Failed to embed code chunk: ${errMsg}`);
      }
    }

    throw new Error(`Failed to embed code chunk ${chunk.id} after retry`);
  }

  /**
   * Embeds multiple code chunks efficiently in batches
   */
  async embedCodeChunks(chunks: CodeChunk[]): Promise<Map<string, number[]>> {
    // ensure service is initialized (embedCodeChunk will re-check if needed)
    await this.ensureInitialized();

    const results = new Map<string, number[]>();
    const chunksToEmbed: CodeChunk[] = [];

    // First check cache
    for (const chunk of chunks) {
      if (this.embeddingCache.has(chunk.id)) {
        results.set(chunk.id, this.embeddingCache.get(chunk.id) ?? []);
      } else {
        chunksToEmbed.push(chunk);
      }
    }

    if (chunksToEmbed.length === 0) {
      return results;
    }

    // Process in batches
    for (let i = 0; i < chunksToEmbed.length; i += this.MAX_BATCH_SIZE) {
      const batch = chunksToEmbed.slice(i, i + this.MAX_BATCH_SIZE);

      logVerbose(
        `Embedding batch ${i / this.MAX_BATCH_SIZE + 1} of ${Math.ceil(
          chunksToEmbed.length / this.MAX_BATCH_SIZE,
        )}`,
      );

      // Process batch in parallel
      const batchPromises = batch.map(async (chunk) => {
        const embedding = await this.embedCodeChunk(chunk);
        results.set(chunk.id, embedding);
      });

      await Promise.all(batchPromises);
    }

    return results;
  }

  /**
   * Embeds a search query
   */
  async embedSearchQuery(query: string, language?: string): Promise<number[]> {
    const client = await this.ensureInitialized();

    for (let attempt = 1; attempt <= this.MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        // Format the query to match code semantics better
        const enhancedQuery = this.enhanceQueryForEmbedding(query, language);

        const response = await client.models.embedContent({
          model: this.EMBEDDING_MODEL,
          contents: [enhancedQuery],
          config:
            this.embeddingDimension != null
              ? { outputDimensionality: this.embeddingDimension }
              : undefined,
        });

        const embedding = response.embeddings?.[0]?.values ?? [];

        // Throttle
        await this.delay(this.THROTTLE_DELAY_MS);
        return embedding;
      } catch (error: unknown) {
        // Error handling as in original
        const errMsg = error instanceof Error ? error.message : String(error);
        if (attempt < this.MAX_RETRY_ATTEMPTS && errMsg.includes('429')) {
          log(
            `Rate limit hit for search query, retry #${attempt} after backoff`,
          );
          await this.delay(this.RETRY_BACKOFF_BASE_MS * attempt);
          continue;
        }
        log(`Error embedding search query "${query}": ${errMsg}`);
        throw new Error(`Failed to embed search query: ${errMsg}`);
      }
    }

    throw new Error(`Failed to embed search query "${query}" after retry`);
  }

  /**
   * Add coding-specific context to search queries for better embedding match
   */
  private enhanceQueryForEmbedding(query: string, language?: string): string {
    let enhancedQuery = query.trim();

    // Don't modify queries that are already detailed
    if (query.length > 100) {
      return `Find code for: ${enhancedQuery}`;
    }

    // Add language context if available
    if (language) {
      enhancedQuery = `${language} code for: ${enhancedQuery}`;
    } else {
      enhancedQuery = `Find code for: ${enhancedQuery}`;
    }

    // Add programming context for short queries
    if (query.length < 50) {
      if (/\b(error|exception|bug|fix)\b/i.test(query)) {
        enhancedQuery += ' implementation with error handling';
      } else if (/\b(api|service|client|request)\b/i.test(query)) {
        enhancedQuery += ' service implementation';
      } else if (/\b(test|spec|assert|mock)\b/i.test(query)) {
        enhancedQuery += ' testing implementation';
      } else if (/\b(auth|login|permission|access)\b/i.test(query)) {
        enhancedQuery += ' authentication implementation';
      } else if (/\b(data|store|database|persist)\b/i.test(query)) {
        enhancedQuery += ' data storage implementation';
      } else if (/\b(ui|interface|display|render)\b/i.test(query)) {
        enhancedQuery += ' user interface implementation';
      }
    }

    return enhancedQuery;
  }
  /**
   * Formats a code chunk to include metadata for better embeddings
   */
  private formatChunkForEmbedding(chunk: CodeChunk): string {
    // Build a structured representation with code first (most important)
    let formattedContent = '';

    // Put the actual code content first - most important for embeddings
    formattedContent += chunk.content;

    // Add semantic context after the code
    formattedContent += '\n\n// SEMANTIC CONTEXT:\n';
    formattedContent += `// LANGUAGE: ${chunk.metadata.language}\n`;
    formattedContent += `// FILE: ${path.basename(chunk.filePath)}\n`;

    // Include symbols which are critical for semantic understanding
    if (chunk.metadata.symbols && chunk.metadata.symbols.length > 0) {
      formattedContent += `// SYMBOLS: ${chunk.metadata.symbols.join(', ')}\n`;
    }

    // Include relevant imports (limited to most important ones)
    if (chunk.metadata.imports && chunk.metadata.imports.length > 0) {
      // Limit to most relevant imports to avoid noise
      const topImports = chunk.metadata.imports.slice(0, 7);
      formattedContent += `// IMPORTS: ${topImports.join(', ')}`;
      if (chunk.metadata.imports.length > 7) {
        formattedContent += ` and ${chunk.metadata.imports.length - 7} more`;
      }
      formattedContent += '\n';
    }

    return formattedContent;
  }

  /**
   * Ensures the AI client is initialized and returns it
   */
  private async ensureInitialized(): Promise<GoogleGenAI> {
    if (!this.aiClient) {
      await this.initialize();
      if (!this.aiClient) {
        throw new Error(
          'Failed to initialize GenAI service. Please check API key.',
        );
      }
    }
    return this.aiClient;
  }

  /**
   * Clears the embedding cache
   */
  clearCache(): void {
    this.embeddingCache.clear();
    log('Embedding cache cleared');
  }

  /**
   * Delay helper for retry logic
   */
  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

//
