import { Pinecone, Index, RecordMetadata } from '@pinecone-database/pinecone';
import { log, logVerbose } from '../logger';
import { CredentialsManager } from './credentialsManager';
import { CodeChunk } from './codeChunker';

interface VectorRecord {
  id: string;
  values: number[];
  metadata: CodeChunkMetadata;
}

interface CodeChunkMetadata extends RecordMetadata {
  filePath: string;
  snapshotId: string;
  language: string;
  startLine: number;
  endLine: number;
  timestamp: number;
  // Note: symbols are now handled separately during vector creation
}

export interface SearchResult {
  chunkId: string;
  filePath: string;
  snapshotId: string;
  score: number;
  metadata: CodeChunkMetadata;
}

export class VectorDatabaseService {
  private readonly INDEX_NAME = 'codelapse-snapshots';
  private readonly DIMENSION = 3072; // Must match Gemini's embedding dimension
  private readonly MAX_INIT_ATTEMPTS = 3;
  private readonly MAX_INDEX_READY_CHECKS = 24;
  private readonly INDEX_READY_POLL_INTERVAL_MS = 5000;

  private credentialsManager: CredentialsManager;
  private pineconeClient: Pinecone | null = null;
  private index: Index | null = null;

  constructor(credentialsManager: CredentialsManager) {
    this.credentialsManager = credentialsManager;
    // Note: Initialization is deferred until first use via ensureInitialized()
  }

  private async waitForIndexReady(client: Pinecone): Promise<void> {
    for (let attempt = 1; attempt <= this.MAX_INDEX_READY_CHECKS; attempt++) {
      const indexDescription = await client.describeIndex(this.INDEX_NAME);
      if (indexDescription.status?.ready === true) {
        return;
      }

      if (attempt < this.MAX_INDEX_READY_CHECKS) {
        log(
          `Waiting for Pinecone index to be ready (attempt ${attempt}/${this.MAX_INDEX_READY_CHECKS})...`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, this.INDEX_READY_POLL_INTERVAL_MS),
        );
      }
    }

    throw new Error(
      `Pinecone index "${this.INDEX_NAME}" was not ready after ${this.MAX_INDEX_READY_CHECKS} checks`,
    );
  }

  private async initialize(): Promise<void> {
    for (let attempt = 1; attempt <= this.MAX_INIT_ATTEMPTS; attempt++) {
      try {
        let apiKey = await this.credentialsManager.getPineconeApiKey();

        if (!apiKey) {
          log('Pinecone API key not found. Prompting for credentials.');
          const got = await this.credentialsManager.promptForCredentials();
          if (!got) {
            throw new Error('Pinecone API key required');
          }
          const newKey = await this.credentialsManager.getPineconeApiKey();
          if (!newKey) {
            throw new Error('Pinecone API key required');
          }
          apiKey = newKey;
        }

        this.pineconeClient = new Pinecone({ apiKey });

        const indexList = await this.pineconeClient.listIndexes();
        const indexNames = indexList.indexes?.map((index) => index.name) || [];
        const indexExists = indexNames.includes(this.INDEX_NAME);

        if (!indexExists) {
          log(`Creating Pinecone index: ${this.INDEX_NAME}`);
          await this.pineconeClient.createIndex({
            name: this.INDEX_NAME,
            dimension: this.DIMENSION,
            metric: 'cosine',
            spec: {
              serverless: {
                cloud: 'aws',
                region: 'us-west-2',
              },
            },
          });
        }

        await this.waitForIndexReady(this.pineconeClient);
        this.index = this.pineconeClient.Index(this.INDEX_NAME);
        log('Vector database service initialized successfully');
        return;
      } catch (error) {
        const isAuthError =
          error instanceof Error &&
          /(rejected|401|Unauthorized)/i.test(error.message);
        if (isAuthError && attempt < this.MAX_INIT_ATTEMPTS) {
          log(
            `Vector database auth failure (attempt ${attempt}/${this.MAX_INIT_ATTEMPTS}). Prompting for new credentials.`,
          );
          const got = await this.credentialsManager.promptForCredentials();
          if (!got) {
            throw error;
          }
          continue;
        }

        log(`Error initializing vector database service: ${error}`);
        throw new Error(
          `Failed to initialize vector database service after ${attempt} attempt(s): ${error}`,
        );
      }
    }

    throw new Error(
      `Failed to initialize vector database service after ${this.MAX_INIT_ATTEMPTS} attempts`,
    );
  }

  /**
   * Retrieve initialized Pinecone index, or throw if missing
   */
  private getIndex(): Index<RecordMetadata> {
    if (!this.index) {
      throw new Error('Vector database not initialized');
    }
    return this.index;
  }

  /**
   * Upserts code chunk vectors to the database
   */
  async upsertVectors(
    snapshotId: string,
    chunks: CodeChunk[],
    embeddings: Map<string, number[]>,
  ): Promise<void> {
    await this.ensureInitialized();

    const timestamp = Date.now();

    const vectors: VectorRecord[] = chunks.map((chunk) => {
      const embedding = embeddings.get(chunk.id);

      if (!embedding) {
        throw new Error(`Embedding not found for chunk: ${chunk.id}`);
      }

      // Create a base metadata object
      const metadata: CodeChunkMetadata & Record<string, string | number> = {
        filePath: chunk.filePath,
        snapshotId: chunk.snapshotId,
        language: chunk.metadata.language,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        timestamp,
      };

      // Only add symbols if they exist
      if (chunk.metadata.symbols && chunk.metadata.symbols.length > 0) {
        metadata.symbols = chunk.metadata.symbols.join(',');
      }

      return {
        id: chunk.id,
        values: embedding,
        metadata,
      };
    });

    // Batch upserts in groups of 100 (Pinecone's limit)
    const BATCH_SIZE = 100;
    for (let i = 0; i < vectors.length; i += BATCH_SIZE) {
      const batch = vectors.slice(i, i + BATCH_SIZE);
      logVerbose(
        `Upserting batch ${i / BATCH_SIZE + 1} of ${Math.ceil(
          vectors.length / BATCH_SIZE,
        )}`,
      );

      const idx = this.getIndex();
      await idx.upsert(batch);
    }

    log(`Upserted ${vectors.length} vectors for snapshot ${snapshotId}`);
  }

  /**
   * Searches for similar code chunks using vector similarity
   */
  async searchSimilarCode(
    queryEmbedding: number[],
    options: {
      limit?: number;
      scoreThreshold?: number;
      snapshotIds?: string[];
      languages?: string[];
    } = {},
  ): Promise<SearchResult[]> {
    await this.ensureInitialized();

    const {
      limit = 10,
      scoreThreshold = 0.65, // Lower default threshold for better recall
      snapshotIds,
      languages,
    } = options;

    // Build Pinecone filter
    const filter: Record<string, any> = {};
    if (languages?.length) filter.language = { $in: languages };
    if (snapshotIds?.length) filter.snapshotId = { $in: snapshotIds };

    // Request more results than needed for post-processing
    const oversampling = Math.min(100, limit * 3);

    // Debug: log query filter
    logVerbose(`Pinecone query filter: ${JSON.stringify(filter)}`);

    // Query Pinecone with oversampling
    const idx = this.getIndex();
    const response = await idx.query({
      vector: queryEmbedding,
      topK: oversampling,
      includeMetadata: true,
      filter,
    });

    // Map matches to SearchResult[]
    let results = (response.matches || []).map((match) => ({
      chunkId: match.id,
      filePath: (match.metadata as CodeChunkMetadata).filePath,
      snapshotId: (match.metadata as CodeChunkMetadata).snapshotId,
      score: match.score ?? 0,
      metadata: match.metadata as CodeChunkMetadata,
    }));

    // Filter on the threshold the caller asked for. Previously this was
    // lowered to max(0.5, scoreThreshold - 0.2), which combined with a second
    // reduction upstream meant the caller's precision setting was discarded.
    results = results.filter((r) => r.score >= scoreThreshold);

    // Group by file to diversify results
    const fileGroups = new Map<string, SearchResult[]>();

    for (const result of results) {
      const fileKey = `${result.snapshotId}:${result.filePath}`;
      if (!fileGroups.has(fileKey)) {
        fileGroups.set(fileKey, []);
      }
      fileGroups.get(fileKey)?.push(result);
    }

    // Sort within each file group
    fileGroups.forEach((group) => {
      group.sort((a, b) => b.score - a.score);
    });

    // First take the best result from each file up to half the limit
    const diverseResults: SearchResult[] = [];
    const fileKeys = Array.from(fileGroups.keys()).sort((a, b) => {
      const aScore = fileGroups.get(a)?.[0]?.score ?? 0;
      const bScore = fileGroups.get(b)?.[0]?.score ?? 0;
      return bScore - aScore;
    });

    // First half: diverse results (one per file)
    const firstRoundLimit = Math.ceil(limit / 2);
    for (const fileKey of fileKeys) {
      if (diverseResults.length >= firstRoundLimit) break;
      const topResultForFile = fileGroups.get(fileKey)?.[0];
      if (topResultForFile) {
        diverseResults.push(topResultForFile);

        // Remove this result from its group
        const group = fileGroups.get(fileKey) || [];
        if (group.length > 0) {
          group.shift();
        }
      }
    }

    // Second half: best remaining results regardless of file
    const remainingResults = Array.from(fileGroups.values())
      .flatMap((group) => group)
      .sort((a, b) => b.score - a.score);

    // Fill up to the limit
    for (const result of remainingResults) {
      if (diverseResults.length >= limit) break;
      // Avoid duplicates
      if (!diverseResults.some((r) => r.chunkId === result.chunkId)) {
        diverseResults.push(result);
      }
    }

    // Final sort by score
    diverseResults.sort((a, b) => b.score - a.score);

    return diverseResults;
  }

  /**
   * Deletes all vectors for a snapshot.
   *
   * Pinecone's v5 data-plane API has no `delete()`. It exposes `deleteAll`,
   * `deleteMany(options)` and `deleteOne(options)` — and for `deleteMany` the
   * **entire argument is the filter**, with no `{ filter: ... }` wrapper
   * (the compiled SDK does `requestOptions.filter = options`). Passing a
   * wrapper filters on a metadata field literally named `filter`, matches no
   * vector, returns HTTP 200 and silently deletes nothing.
   */
  async deleteSnapshotVectors(snapshotId: string): Promise<void> {
    await this.ensureInitialized();
    const idx = this.getIndex();

    const deleteMany = (idx as unknown as { deleteMany?: unknown }).deleteMany;
    if (typeof deleteMany !== 'function') {
      // Surface the API drift rather than swallowing it: the previous
      // implementation called a nonexistent `delete` through an `any` cast,
      // so tsc could not see it and the TypeError was caught and logged after
      // the caller had already recorded the snapshot as de-indexed.
      throw new Error(
        'The vector store client does not expose deleteMany(); cannot purge vectors. Update @pinecone-database/pinecone.',
      );
    }

    try {
      await (
        idx as unknown as {
          deleteMany: (options: object) => Promise<void>;
        }
      ).deleteMany({ snapshotId: { $eq: snapshotId } });
      log(`Deleted vectors for snapshot ${snapshotId}`);
    } catch (error) {
      log(`Error deleting vectors for snapshot ${snapshotId}: ${error}`);
      throw new Error(`Failed to delete vectors for snapshot: ${error}`);
    }
  }

  /**
   * Ensures the vector database service is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.pineconeClient || !this.index) {
      await this.initialize();

      if (!this.pineconeClient || !this.index) {
        throw new Error(
          'Failed to initialize vector database service. Please check API key.',
        );
      }
    }
  }
}
