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

  private credentialsManager: CredentialsManager;
  private pineconeClient: Pinecone | null = null;
  private index: Index | null = null;

  constructor(credentialsManager: CredentialsManager) {
    this.credentialsManager = credentialsManager;
    // Note: Initialization is deferred until first use via ensureInitialized()
  }

  private async initialize(): Promise<void> {
    try {
      let apiKey = await this.credentialsManager.getPineconeApiKey();

      if (!apiKey) {
        log('Pinecone API key not found. Prompting for credentials.');
        const got = await this.credentialsManager.promptForCredentials();
        if (!got) throw new Error('Pinecone API key required');
        const newKey = await this.credentialsManager.getPineconeApiKey();
        if (!newKey) throw new Error('Pinecone API key required');
        apiKey = newKey;
      }

      const validKey = apiKey;
      this.pineconeClient = new Pinecone({ apiKey: validKey });

      // Check if index exists
      const indexList = await this.pineconeClient.listIndexes();
      // Extract index names and check if our index exists
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

        // Wait for index to be ready
        let isReady = false;
        while (!isReady) {
          const indexDescription = await this.pineconeClient.describeIndex(
            this.INDEX_NAME,
          );
          isReady = indexDescription.status?.ready === true;
          if (!isReady) {
            log('Waiting for Pinecone index to be ready...');
            await new Promise((resolve) => setTimeout(resolve, 5000));
          }
        }
      }

      this.index = this.pineconeClient.Index(this.INDEX_NAME);
      log('Vector database service initialized successfully');
    } catch (error) {
      // On auth failures (key rejected) prompt for new Pinecone API key and retry
      if (
        error instanceof Error &&
        /(rejected|401|Unauthorized)/i.test(error.message)
      ) {
        const got = await this.credentialsManager.promptForCredentials();
        if (!got) throw error;
        return this.initialize();
      }

      log(`Error initializing vector database service: ${error}`);
      throw new Error(`Failed to initialize vector database service: ${error}`);
    }
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

    // Initial filtering with a lower threshold for diversity
    results = results.filter(
      (r) => r.score >= Math.max(0.5, scoreThreshold - 0.2),
    );

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
   * Deletes all vectors for a snapshot
   */
  async deleteSnapshotVectors(snapshotId: string): Promise<void> {
    await this.ensureInitialized();
    const idx = this.getIndex();
    try {
      // Delete vectors by snapshotId metadata filter
      await (idx as any).delete({
        filter: {
          snapshotId: { $eq: snapshotId },
        },
      });
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
