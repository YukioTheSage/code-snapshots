import { GoogleGenAI } from '@google/genai';
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { log, logVerbose } from '../logger';
import { CredentialsManager } from './credentialsManager';
import { CodeChunk } from './codeChunker';
import { isInteractiveUiDisabled } from '../headless';
import path = require('path');

export class EmbeddingService {
  /**
   * Model ids are read through getModelId rather than captured in a field: a
   * hardcoded id is what made the previous experimental model's retirement
   * (2025-10-30) unrecoverable without shipping a new version.
   *
   * `gemini-embedding-2` is the current GA embedding model and Google's
   * documented replacement for `gemini-embedding-exp-03-07`; see
   * https://ai.google.dev/gemini-api/docs/deprecations
   */
  private static readonly DEFAULT_MODEL = 'gemini-embedding-2';
  private static readonly DEFAULT_DIMENSION = 3072;

  private readonly MAX_BATCH_SIZE = 10; // Maximum number of chunks to embed at once
  private readonly MAX_RETRY_ATTEMPTS = 3;
  private readonly MAX_INIT_ATTEMPTS = 3;
  private readonly RETRY_BACKOFF_BASE_MS = 10000;
  private readonly EMBEDDING_CACHE_LIMIT = 1000;
  private credentialsManager: CredentialsManager;
  private aiClient: GoogleGenAI | null = null;

  // Caching to avoid redundant embedding generation
  private embeddingCache: Map<string, number[]> = new Map();

  constructor(credentialsManager: CredentialsManager) {
    this.credentialsManager = credentialsManager;
    // Note: Initialization is deferred until first use via ensureInitialized()
  }

  private async initialize(): Promise<void> {
    for (let attempt = 1; attempt <= this.MAX_INIT_ATTEMPTS; attempt++) {
      try {
        let apiKey = await this.credentialsManager.getGeminiApiKey();

        if (!apiKey) {
          // Headless contexts (integration tests, CI) cannot answer an input
          // box; fail fast instead of hanging on `showInputBox`. Shared
          // predicate (src/headless.ts) so every prompt site agrees.
          if (isInteractiveUiDisabled()) {
            throw new Error('Gemini API key required');
          }
          log('Gemini API key not found. Prompting for credentials.');
          const got = await this.credentialsManager.promptForCredentials();
          if (!got) {
            throw new Error('Gemini API key required');
          }
          const newKey = await this.credentialsManager.getGeminiApiKey();
          if (!newKey) {
            throw new Error('Gemini API key required');
          }
          apiKey = newKey;
        }

        this.aiClient = new GoogleGenAI({ apiKey });
        log('GenAI Embedding service initialized successfully');
        return;
      } catch (error) {
        const isAuthError =
          error instanceof Error && /401|Unauthorized/i.test(error.message);
        if (isAuthError && attempt < this.MAX_INIT_ATTEMPTS) {
          log(
            `Embedding initialization authentication failure (attempt ${attempt}/${this.MAX_INIT_ATTEMPTS}). Prompting for credentials.`,
          );
          const got = await this.credentialsManager.promptForCredentials();
          if (!got) {
            throw error;
          }
          continue;
        }

        log(`Error initializing GenAI Embedding service: ${error}`);
        throw new Error(
          `Failed to initialize GenAI Embedding service after ${attempt} attempt(s): ${error}`,
        );
      }
    }

    throw new Error(
      `Failed to initialize GenAI Embedding service after ${this.MAX_INIT_ATTEMPTS} attempts`,
    );
  }

  /**
   * Read at call time rather than cached in the constructor so a settings
   * change takes effect without reloading the window.
   */
  private config(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('vscode-snapshots.semanticSearch');
  }

  /**
   * The embedding model id, from `semanticSearch.embedding.model`.
   */
  public getModelId(): string {
    return this.config().get<string>(
      'embedding.model',
      EmbeddingService.DEFAULT_MODEL,
    );
  }

  /**
   * The embedding output dimension, from
   * `semanticSearch.embedding.dimension`.
   *
   * A non-numeric or non-positive value falls back to the default rather than
   * reaching the API: the vector index is dimensioned when it is created, so a
   * rejected or mismatched vector is worse than a predictable one.
   */
  public getDimension(): number {
    const configured = this.config().get<number>(
      'embedding.dimension',
      EmbeddingService.DEFAULT_DIMENSION,
    );
    return Number.isFinite(configured) && configured > 0
      ? configured
      : EmbeddingService.DEFAULT_DIMENSION;
  }

  /**
   * Embeds a single code chunk
   */
  async embedCodeChunk(chunk: CodeChunk): Promise<number[]> {
    // Format once: this string is both the cache key's payload and the exact
    // request body, so the cache can only ever return a vector that was
    // produced for this request.
    const formattedContent = this.formatChunkForEmbedding(chunk);
    const cacheKey = this.embeddingCacheKey(formattedContent);

    // Check cache first
    const cached = this.getCachedEmbedding(cacheKey);
    if (cached) {
      logVerbose(`Using cached embedding for chunk ${chunk.id}`);
      return cached;
    }

    const client = await this.ensureInitialized();

    for (let attempt = 1; attempt <= this.MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        const response = await client.models.embedContent({
          model: this.getModelId(),
          contents: [formattedContent],
          config: { outputDimensionality: this.getDimension() },
        });

        const embedding = response.embeddings?.[0]?.values ?? [];

        // No fixed post-success delay: a five-second sleep after every response
        // was the dominant cost of indexing and did nothing for a quota that
        // was not being approached. The 429 branch below is the rate limiter.
        this.setCachedEmbedding(cacheKey, embedding);
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
      const cached = this.getCachedEmbedding(
        this.embeddingCacheKey(this.formatChunkForEmbedding(chunk)),
      );
      if (cached) {
        results.set(chunk.id, cached);
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
          model: this.getModelId(),
          contents: [enhancedQuery],
          config: { outputDimensionality: this.getDimension() },
        });

        const embedding = response.embeddings?.[0]?.values ?? [];

        // No fixed post-success delay: a five-second sleep after every response
        // was the dominant cost of a search and did nothing for a quota that
        // was not being approached. The 429 branch below is the rate limiter.
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
   * Cache key for an embedding request.
   *
   * Hashes the model id, the output dimension and the exact formatted content
   * rather than `chunk.id`. Keying on `chunk.id` meant a re-chunked file with
   * the same path and line span reused the previous content's vector.
   *
   * The model and dimension are part of the key because both are read from
   * configuration on every call: without them, changing the model in settings
   * would keep serving vectors produced by the previous one, which is the same
   * class of silent wrongness this key exists to prevent.
   *
   * The NUL separator keeps the fields unambiguous.
   */
  private embeddingCacheKey(formattedContent: string): string {
    return crypto
      .createHash('sha1')
      .update(this.getModelId(), 'utf8')
      .update('\u0000')
      .update(String(this.getDimension()), 'utf8')
      .update('\u0000')
      .update(formattedContent, 'utf8')
      .digest('hex');
  }

  private getCachedEmbedding(key: string): number[] | undefined {
    const value = this.embeddingCache.get(key);
    if (!value) {
      return undefined;
    }

    // Refresh recency for LRU behavior.
    this.embeddingCache.delete(key);
    this.embeddingCache.set(key, value);
    return value;
  }

  private setCachedEmbedding(key: string, embedding: number[]): void {
    if (this.embeddingCache.has(key)) {
      this.embeddingCache.delete(key);
    }
    this.embeddingCache.set(key, embedding);

    if (this.embeddingCache.size > this.EMBEDDING_CACHE_LIMIT) {
      const oldestKey = this.embeddingCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.embeddingCache.delete(oldestKey);
      }
    }
  }

  /**
   * Delay helper for retry logic
   */
  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

//
