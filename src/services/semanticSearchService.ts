import * as vscode from 'vscode';
import { runWithConcurrencyLimit } from 'codelapse-core';
import { log, logVerbose } from '../logger';
import { SnapshotManager, Snapshot } from '../snapshotManager';
import { CredentialsManager } from './credentialsManager';
import { CodeChunker, CodeChunk } from './codeChunker';
import { EmbeddingService } from './embeddingService';
import { VectorDatabaseService } from './vectorDatabaseService';
import {
  EnhancedSemanticSearchOptions,
  EnhancedSemanticSearchResult,
  RankingStrategy,
  ProcessedQuery,
  QueryIntent,
  SecurityConsideration,
  PerformanceMetrics,
} from '../types/enhancedSearch';
import { EnhancedCodeChunker } from './enhancedCodeChunker';
import { QualityMetrics } from '../types/enhancedChunking';
import { DEFAULT_QUALITY_METRICS, toRatio } from './qualityScale';
import { QueryProcessor, QueryContext } from './queryProcessor';
import { ResultManager } from './resultManager';
import { throwIfCancelled } from '../utils/cancellation';
import { getWorkspaceId } from './workspaceIdentity';

export interface SemanticSearchOptions {
  query: string;
  snapshotIds?: string[];
  limit?: number;
  languages?: string[];
  scoreThreshold?: number;
}

/**
 * What an indexing run actually did.
 *
 * `attempted` counts snapshots the run tried; `succeeded` counts the ones that
 * were indexed. They differ whenever a snapshot failed, which the previous
 * reporting hid.
 */
export interface IndexingOutcome {
  attempted: number;
  succeeded: number;
  failed: Array<{ snapshotId: string; error: string }>;
}

export interface SemanticSearchResult {
  snapshotId: string;
  snapshot: Snapshot;
  filePath: string;
  startLine: number;
  endLine: number;
  /**
   * Raw cosine similarity from the vector store. Never a rescaled value:
   * min-max normalization is a ranking device and lives in `rankingScore`.
   */
  score: number;
  /**
   * Internally normalized score used to order results, set by ResultManager.
   * Kept separate from `score` because `score` is shown to users as a
   * similarity percentage and averaged into `averageRelevanceScore` for API
   * consumers; overwriting it made the top hit always report 100%.
   */
  rankingScore?: number;
  content: string;
  timestamp: number;
  /**
   * Quality metrics for this chunk, computed from its own content.
   *
   * Optional because only the search path can produce them; `ResultManager`
   * keeps its default for anything that arrives without them, so a caller that
   * builds a `SemanticSearchResult` by hand is unaffected.
   */
  qualityMetrics?: QualityMetrics;
}

/**
 * Returns the caller's score threshold unchanged, clamped to [0, 1].
 *
 * Previously the threshold was lowered twice -- by 0.15 in
 * SemanticSearchService and by 0.2 in VectorDatabaseService -- giving an
 * effective floor of max(0.5, requested - 0.35), which made a slider at 0.95
 * admit 0.60-similarity code with no indication that the requested precision
 * had been discarded.
 */
export function resolveScoreThreshold(requested: number): number {
  if (!Number.isFinite(requested)) {
    return 0;
  }
  return Math.max(0, Math.min(1, requested));
}

/**
 * Identity of a result inside one workspace: the same tuple the chunker uses to
 * name a chunk.
 */
function resultIdentity(result: SemanticSearchResult): string {
  return `${result.snapshotId}:${result.filePath}:${result.startLine}`;
}

/**
 * Total order over search results: score descending, timestamp descending, then
 * identity ascending.
 *
 * The previous comparator gave any pair of scores within 5% a timestamp
 * tie-break and compared scores otherwise. That relation is not transitive, so
 * it is not an order at all: with scores 1.00 / 0.96 / 0.92 and timestamps
 * 1 / 3 / 2 it ranked 0.96 first, and it left exact ties to `Array#sort`'s input
 * order, so the same result set could come back in two different orders. The
 * identity tie-break is what makes the output independent of the input order.
 */
export function compareSearchResults(
  a: SemanticSearchResult,
  b: SemanticSearchResult,
): number {
  if (a.score !== b.score) {
    return b.score - a.score;
  }
  if (a.timestamp !== b.timestamp) {
    return b.timestamp - a.timestamp;
  }
  const aIdentity = resultIdentity(a);
  const bIdentity = resultIdentity(b);
  if (aIdentity === bIdentity) {
    return 0;
  }
  return aIdentity < bIdentity ? -1 : 1;
}

export class SemanticSearchService implements vscode.Disposable {
  private snapshotManager: SnapshotManager;
  private credentialsManager: CredentialsManager;
  private context: vscode.ExtensionContext;
  private codeChunker: CodeChunker;
  private embeddingService: EmbeddingService;
  private vectorDatabaseService: VectorDatabaseService;

  // Enhanced services for AI agent optimization
  private enhancedCodeChunker: EnhancedCodeChunker;
  private queryProcessor: QueryProcessor;
  private resultManager: ResultManager;

  // Background processing
  private processingQueue: string[] = []; // Queue of snapshot IDs to process
  private isProcessing = false;
  /**
   * The id taken off the queue for the pass in progress. It is neither in the
   * queue nor in `indexedSnapshots` yet, so the dedupe in
   * `handleSnapshotChanges` has to know about it.
   */
  private inFlightSnapshotId: string | undefined;
  /**
   * How many result contents are read at once. Each read is one snapshot-file
   * read plus one chunking pass, so the sequential loop made a forty-hit search
   * pay forty read latencies in series; the bound keeps a large result set from
   * opening every snapshot file at once.
   */
  private readonly MAX_CONTENT_READ_CONCURRENCY = 4;
  /** Set by `dispose()`. Checked before any further work or state write. */
  private disposed = false;
  /** The snapshot-change subscription, released by `dispose()`. */
  private snapshotChangeSubscription: vscode.Disposable | undefined;

  // Cache of which snapshots have been indexed
  private indexedSnapshots: Set<string> = new Set();

  // Performance tracking
  private performanceMetrics: Map<string, PerformanceMetrics> = new Map();

  constructor(
    snapshotManager: SnapshotManager,
    credentialsManager: CredentialsManager,
    context: vscode.ExtensionContext,
  ) {
    this.snapshotManager = snapshotManager;
    this.credentialsManager = credentialsManager;
    this.context = context;
    this.codeChunker = new CodeChunker();
    this.embeddingService = new EmbeddingService(credentialsManager);
    const workspaceRoot = this.snapshotManager.getWorkspaceRoot?.() ?? null;
    this.vectorDatabaseService = new VectorDatabaseService(
      credentialsManager,
      getWorkspaceId(workspaceRoot),
    );

    // Initialize enhanced services for AI agent optimization
    this.enhancedCodeChunker = new EnhancedCodeChunker();
    this.queryProcessor = new QueryProcessor();
    this.resultManager = new ResultManager();

    this.initialize();

    // Listen for snapshot changes. The subscription is kept: without it
    // `dispose()` could not release the listener, and the manager kept calling
    // into a disposed service for the life of the host.
    this.snapshotChangeSubscription = this.snapshotManager.onDidChangeSnapshots(
      () => {
        this.handleSnapshotChanges();
      },
    );
  }

  private async initialize(): Promise<void> {
    try {
      // Initialize services (mostly handled in their constructors)

      // Check if credentials exist, prompt if not
      const hasCredentials = await this.credentialsManager.hasCredentials();
      if (!hasCredentials) {
        // Don't automatically prompt - we'll prompt when the feature is used
        log(
          'Semantic search credentials not found. Will prompt when feature is used.',
        );
      }

      log('Semantic search service initialized');
      // Load persisted indexed snapshots
      const persisted = this.context.workspaceState.get<string[]>(
        'semanticSearch.indexedSnapshots',
        [],
      );
      persisted.forEach((id) => this.indexedSnapshots.add(id));
      log(`Loaded persisted indexed snapshots: ${this.indexedSnapshots.size}`);
    } catch (error) {
      log(`Error initializing semantic search service: ${error}`);
    }
  }

  /**
   * Searches for code across snapshots using natural language queries
   */
  /**
   * Searches for code across snapshots using natural language queries with
   * enhanced query processing, result diversification, and intelligent ranking.
   */
  async searchCode(
    options: SemanticSearchOptions,
  ): Promise<SemanticSearchResult[]> {
    // Ensure credentials are set up
    const hasCredentials = await this.credentialsManager.hasCredentials();
    if (!hasCredentials) {
      const credentialsSet =
        await this.credentialsManager.promptForCredentials();
      if (!credentialsSet) {
        throw new Error('API credentials required for semantic search');
      }
    }

    const {
      query,
      snapshotIds,
      limit = 20,
      languages,
      scoreThreshold = 0.65, // Lower default threshold for better recall
    } = options;

    log(`Performing semantic search: "${query}"`);

    // Apply query enhancement for better results
    const enhancedQuery = this.enhanceSearchQuery(query, languages);
    logVerbose(`Enhanced query: "${enhancedQuery}"`);

    // Embed the enhanced search query with language context if available
    const queryEmbedding = await this.embeddingService.embedSearchQuery(
      enhancedQuery,
      languages?.length === 1 ? languages[0] : undefined,
    );

    // Determine which snapshots to search (use all if none specified)
    const allIds = this.snapshotManager.getSnapshots().map((s) => s.id);
    const snapshotIdsToSearch =
      snapshotIds && snapshotIds.length > 0 ? snapshotIds : allIds;

    // Search for similar code with improved parameters
    const searchResults = await this.vectorDatabaseService.searchSimilarCode(
      queryEmbedding,
      {
        limit: Math.min(100, limit * 2), // Request more results to allow for diverse filtering
        snapshotIds: snapshotIdsToSearch,
        languages,
        scoreThreshold: resolveScoreThreshold(scoreThreshold),
      },
    );

    // Debug logging of raw results count
    log(
      `SemanticSearchService.searchCode raw results count: ${searchResults.length}`,
    );

    // Track which files we've already included results from (for diversity)
    const includedFiles = new Map<string, number>(); // file key -> count

    // Enhance results with actual content and snapshot info
    const enhancedResults: (SemanticSearchResult & { fileKey: string })[] = [];

    // First pass: process all results and enrich with content. One read per
    // result, with a fixed ceiling on how many are in flight, and the helper
    // writes each result back at its input index so the array stays aligned
    // with `searchResults`. The whole callback body is inside its own
    // try/catch: a failed read returns `undefined` instead of rejecting, which
    // matters because the helper propagates a rejection out of the pass and
    // would fail the whole search rather than drop the one result whose read
    // failed.
    const processedResults = (
      await runWithConcurrencyLimit(
        searchResults,
        this.MAX_CONTENT_READ_CONCURRENCY,
        async (result) => {
          try {
            const snapshot = this.snapshotManager.getSnapshotById(
              result.snapshotId,
            );

            if (!snapshot) {
              logVerbose(
                `Snapshot ${result.snapshotId} not found, skipping result`,
              );
              return undefined;
            }

            const content =
              await this.snapshotManager.getSnapshotFileContentPublic(
                result.snapshotId,
                result.filePath,
              );

            if (!content) {
              logVerbose(
                `Content not found for ${result.filePath} in snapshot ${result.snapshotId}`,
              );
              return undefined;
            }

            // Extract the specific chunk of content
            const lines = content.split('\n');
            const startLine = Math.max(0, result.metadata.startLine);
            const endLine = Math.min(lines.length - 1, result.metadata.endLine);

            const chunkContent = lines.slice(startLine, endLine + 1).join('\n');

            // Add context lines if needed for better understanding
            let contentWithContext = chunkContent;
            const contextLines = 5; // Add 5 lines of context if available

            if (startLine > contextLines) {
              // Add context before
              const contextBefore = lines
                .slice(Math.max(0, startLine - contextLines), startLine)
                .join('\n');
              if (contextBefore.trim()) {
                contentWithContext = `// Context before:\n${contextBefore}\n\n${contentWithContext}`;
              }
            }

            const fileKey = `${result.snapshotId}:${result.filePath}`;

            const processedResult: SemanticSearchResult = {
              snapshotId: result.snapshotId,
              snapshot,
              filePath: result.filePath,
              startLine,
              endLine,
              score: result.score,
              content: contentWithContext,
              timestamp: snapshot.timestamp,
            };
            return {
              ...(await this.attachQualityMetrics(processedResult)),
              fileKey,
            };
          } catch (error) {
            log(`Error enhancing search result: ${error}`);
            return undefined;
          }
        },
      )
    ).filter(
      (result): result is SemanticSearchResult & { fileKey: string } =>
        result !== undefined,
    );

    // Sort all processed results for the initial ranking. The same total order
    // as the final sort: which result is "first per file" in the diversity pass
    // must not depend on the order the vector store happened to return.
    processedResults.sort(compareSearchResults);

    // Second pass: apply diversity while maintaining quality
    // First take top results with diversity consideration (1 per file for top half)
    const halfLimit = Math.ceil(limit / 2);

    // Take the top half of results with file diversity (one result per file)
    for (const result of processedResults) {
      if (enhancedResults.length >= halfLimit) break;

      // Only include one result per file in the first half
      if (!includedFiles.has(result.fileKey)) {
        enhancedResults.push(result);
        includedFiles.set(result.fileKey, 1);
      }
    }

    // For the remaining half, take the best results regardless of file
    // but limit to max 3 results per file for diversity
    for (const result of processedResults) {
      if (enhancedResults.length >= limit) break;

      // Skip results we've already included
      if (
        enhancedResults.some(
          (r) =>
            r.snapshotId === result.snapshotId &&
            r.startLine === result.startLine &&
            r.filePath === result.filePath,
        )
      ) {
        continue;
      }

      // Limit to 3 results per file for diversity
      const fileCount = includedFiles.get(result.fileKey) || 0;
      if (fileCount < 3) {
        enhancedResults.push(result);
        includedFiles.set(result.fileKey, fileCount + 1);
      }
    }

    // Final sort: a total order, so the output does not depend on the input.
    enhancedResults.sort(compareSearchResults);

    // Remove the fileKey property that was used internally
    const finalResults = enhancedResults.map((result) => {
      const { fileKey, ...rest } = result;
      // Kept as an explicit read so the destructuring-only variable is not an
      // unused-binding lint warning.
      void fileKey;
      return rest;
    });

    log(
      `Search returned ${finalResults.length} results with diversity optimization`,
    );
    return finalResults.slice(0, limit);
  }

  /**
   * Enhanced semantic search optimized for AI agents with rich metadata and explanations
   */
  async searchCodeEnhanced(
    options: EnhancedSemanticSearchOptions,
  ): Promise<EnhancedSemanticSearchResult[]> {
    const startTime = Date.now();

    // Ensure credentials are set up
    const hasCredentials = await this.credentialsManager.hasCredentials();
    if (!hasCredentials) {
      const credentialsSet =
        await this.credentialsManager.promptForCredentials();
      if (!credentialsSet) {
        throw new Error(
          'API credentials required for enhanced semantic search',
        );
      }
    }

    log(`Performing enhanced semantic search: "${options.query}"`);

    // Process and enhance the query
    const processedQuery = await this.processQuery(options);
    const queryProcessingTime = Date.now() - startTime;

    // Execute the search based on the processed query
    const searchStartTime = Date.now();
    const baseResults = await this.executeEnhancedSearch(
      processedQuery,
      options,
    );
    const searchTime = Date.now() - searchStartTime;

    // Process and enhance results
    const resultProcessingStartTime = Date.now();
    const enhancedResults = await this.processAndEnhanceResults(
      baseResults,
      processedQuery,
      options,
    );
    const resultProcessingTime = Date.now() - resultProcessingStartTime;

    // Calculate performance metrics
    const totalTime = Date.now() - startTime;
    const performanceMetrics: PerformanceMetrics = {
      queryProcessingTime,
      searchTime,
      resultProcessingTime,
      totalTime,
      memoryUsage: process.memoryUsage().heapUsed,
      cacheHitRate: 0, // TODO: Implement cache hit tracking
      chunksSearched: baseResults.length,
      vectorOperations: baseResults.length,
    };

    // Store performance metrics for analysis
    this.performanceMetrics.set(options.query, performanceMetrics);

    log(
      `Enhanced search completed in ${totalTime}ms, returned ${enhancedResults.length} results`,
    );
    return enhancedResults;
  }

  /**
   * Process and enhance the search query with AI-specific optimizations using QueryProcessor
   */
  private async processQuery(
    options: EnhancedSemanticSearchOptions,
  ): Promise<ProcessedQuery> {
    const { query, languages, searchMode } = options;

    // Create query context from options
    const context: QueryContext = {
      language: languages?.[0],
      availableSnapshots: this.snapshotManager.getSnapshots().map((s) => s.id),
    };

    // Use QueryProcessor for comprehensive query processing
    const processedQuery = await this.queryProcessor.processQuery(
      query,
      context,
    );

    // Override search mode if specified in options
    if (searchMode && searchMode !== processedQuery.searchStrategy.mode) {
      processedQuery.searchStrategy.mode = searchMode;
    }

    // Override ranking strategy if specified in options
    if (
      options.rankingStrategy &&
      options.rankingStrategy !== processedQuery.searchStrategy.ranking
    ) {
      processedQuery.searchStrategy.ranking = options.rankingStrategy;
    }

    // Merge filter criteria from options
    if (options.filterCriteria) {
      processedQuery.filters = {
        ...processedQuery.filters,
        ...options.filterCriteria,
      };
    }

    return processedQuery;
  }

  /**
   * Classify the intent of a search query
   */

  /**
   * Execute enhanced search based on processed query
   */
  private async executeEnhancedSearch(
    processedQuery: ProcessedQuery,
    options: EnhancedSemanticSearchOptions,
  ): Promise<SemanticSearchResult[]> {
    // Convert enhanced options to base search options
    const baseOptions: SemanticSearchOptions = {
      query: processedQuery.enhancedQuery,
      snapshotIds: options.snapshotIds,
      limit: Math.min(100, (options.limit || 20) * 3), // Get more results for processing
      languages: options.languages,
      scoreThreshold: this.adjustScoreThreshold(
        options.scoreThreshold,
        processedQuery.intent,
      ),
    };

    // Execute base search
    return await this.searchCode(baseOptions);
  }

  /**
   * Adjust score threshold based on query intent
   */
  private adjustScoreThreshold(
    threshold: number | undefined,
    intent: QueryIntent,
  ): number {
    const baseThreshold = threshold || 0.65;

    // Adjust threshold based on intent
    switch (intent.primary) {
      case 'find_examples':
        return Math.max(0.7, baseThreshold); // Higher threshold for examples
      case 'debug_issue':
        return Math.max(0.6, baseThreshold - 0.1); // Lower threshold for debugging
      case 'find_similar':
        return Math.max(0.75, baseThreshold + 0.1); // Higher threshold for similarity
      case 'analyze_quality':
        return Math.max(0.8, baseThreshold + 0.15); // Highest threshold for quality
      default:
        return baseThreshold;
    }
  }

  /**
   * Compute this result's quality metrics with the chunker already constructed
   * for exactly this path. Computed once per result and cached on the result
   * object because ranking reads the metrics several times.
   */
  private async attachQualityMetrics(
    result: SemanticSearchResult,
  ): Promise<SemanticSearchResult> {
    if (result.qualityMetrics) {
      return result;
    }

    try {
      const chunks = await this.enhancedCodeChunker.chunkFileEnhanced(
        result.filePath,
        result.content,
        result.snapshotId,
      );
      const chunk =
        chunks.find(
          (candidate) =>
            candidate.startLine <= result.startLine &&
            candidate.endLine >= result.endLine,
        ) ?? chunks[0];
      return chunk
        ? { ...result, qualityMetrics: chunk.qualityMetrics }
        : result;
    } catch (error) {
      // Metrics are an enhancement, not a precondition: a chunker failure must
      // leave the result searchable with the default metrics.
      log(`Unable to compute quality metrics for ${result.filePath}: ${error}`);
      return result;
    }
  }
  /**
   * Process and enhance search results with AI-specific metadata using ResultManager
   */
  private async processAndEnhanceResults(
    baseResults: SemanticSearchResult[],
    processedQuery: ProcessedQuery,
    options: EnhancedSemanticSearchOptions,
  ): Promise<EnhancedSemanticSearchResult[]> {
    // Use ResultManager for comprehensive result processing
    const { results } = await this.resultManager.processResults(
      baseResults,
      processedQuery,
      options,
    );

    logVerbose(
      `ResultManager processed ${baseResults.length} → ${results.length} results`,
    );
    return results;
  }

  /**
   * Retrieves a snapshot by its ID.
   * @param snapshotId The ID of the snapshot to retrieve.
   * @returns The snapshot object, or undefined if not found.
   */
  public getSnapshotById(snapshotId: string): Snapshot | undefined {
    return this.snapshotManager.getSnapshotById(snapshotId);
  }

  /**
   * Process snapshot changes
   */
  private handleSnapshotChanges(): void {
    // Fully inert once disposed: a listener that outlived the subscription, or
    // a direct call, must not repopulate the queue of a dead service.
    if (this.disposed) {
      return;
    }

    // Check auto-index config and skip if disabled
    const autoIndexEnabled = vscode.workspace
      .getConfiguration('vscode-snapshots')
      .get<boolean>('semanticSearch.autoIndex', false);
    if (!autoIndexEnabled) {
      log(
        'Auto-index disabled, skipping semantic indexing on snapshot changes',
      );
      return;
    }

    // Get latest snapshots
    const snapshots = this.snapshotManager.getSnapshots();

    // Find snapshots that need indexing
    const pendingSnapshots = snapshots
      .filter((snapshot) => !this.indexedSnapshots.has(snapshot.id))
      .map((snapshot) => snapshot.id);

    if (pendingSnapshots.length > 0) {
      log(`Found ${pendingSnapshots.length} snapshots that need indexing`);

      // Deduplicate: every change event re-lists the snapshots that are not
      // indexed yet, so an undeduplicated push queued the same id once per
      // saved file and indexed it that many times. The in-flight id is part of
      // that set: it has left the queue but is not indexed yet, so a save
      // landing mid-index would otherwise queue a second copy.
      const alreadyQueued = new Set(this.processingQueue);
      if (this.inFlightSnapshotId !== undefined) {
        alreadyQueued.add(this.inFlightSnapshotId);
      }
      for (const snapshotId of pendingSnapshots) {
        if (alreadyQueued.has(snapshotId)) {
          continue;
        }
        this.processingQueue.push(snapshotId);
        alreadyQueued.add(snapshotId);
      }

      // Start processing if not already processing
      if (!this.isProcessing) {
        void this.processNextSnapshot();
      }
    }
  }

  /**
   * Enhance the search query with contextual information to improve embedding matching
   */
  private enhanceSearchQuery(query: string, languages?: string[]): string {
    // Detailed queries don't need much enhancement
    if (query.length > 100) {
      return query;
    }

    let enhancedQuery = query.trim();

    // Add language context if provided and not already in query
    if (languages?.length === 1) {
      const language = languages[0].toLowerCase();
      if (!enhancedQuery.toLowerCase().includes(language)) {
        enhancedQuery = `${languages[0]} ${enhancedQuery}`;
      }
    }

    // Add coding-specific context for short queries
    if (query.length < 70) {
      // Detect query intent and add appropriate context
      if (/\b(error|exception|bug|fix|catch|try)\b/i.test(query)) {
        enhancedQuery += ' error handling code';
      } else if (
        /\b(api|endpoint|service|client|request|response|fetch|http)\b/i.test(
          query,
        )
      ) {
        enhancedQuery += ' service implementation';
      } else if (/\b(test|spec|assert|mock|stub|verify)\b/i.test(query)) {
        enhancedQuery += ' test implementation';
      } else if (
        /\b(auth|login|permission|access|token|jwt|authenticate)\b/i.test(query)
      ) {
        enhancedQuery += ' authentication code';
      } else if (
        /\b(data|store|database|db|persist|save|load|query)\b/i.test(query)
      ) {
        enhancedQuery += ' data storage code';
      } else if (
        /\b(ui|interface|display|render|component|view|screen)\b/i.test(query)
      ) {
        enhancedQuery += ' interface code';
      } else if (
        /\b(algorithm|sort|search|tree|graph|compute)\b/i.test(query)
      ) {
        enhancedQuery += ' algorithm implementation';
      } else if (/\b(parse|format|convert|transform)\b/i.test(query)) {
        enhancedQuery += ' data transformation code';
      } else if (/\b(config|setting|option|parameter|env)\b/i.test(query)) {
        enhancedQuery += ' configuration code';
      } else if (/\b(util|helper|common)\b/i.test(query)) {
        enhancedQuery += ' utility function';
      } else {
        // Generic enhancement for other queries
        enhancedQuery += ' implementation code';
      }
    }

    return enhancedQuery;
  }

  /**
   * Process the next snapshot in the queue
   */
  private async processNextSnapshot(): Promise<void> {
    if (this.disposed) {
      this.isProcessing = false;
      return;
    }

    if (this.processingQueue.length === 0) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;

    // Get next snapshot ID
    const snapshotId = this.processingQueue.shift();
    if (!snapshotId) {
      this.isProcessing = false;
      return;
    }

    // Off the queue but not indexed yet: record it for the duration of the
    // pass so a change event cannot queue a second copy of it.
    this.inFlightSnapshotId = snapshotId;

    try {
      log(`Processing snapshot ${snapshotId} for indexing`);

      // Check if credentials exist
      const hasCredentials = await this.credentialsManager.hasCredentials();
      if (!hasCredentials) {
        // Put the id back and stop the chain: credentials may be configured
        // later, and every id behind this one would hit the same missing key.
        // The previous code returned without re-queueing, so this snapshot was
        // never indexed in the session and nothing said so.
        this.processingQueue.unshift(snapshotId);
        log(
          `Semantic search credentials not found. Snapshot ${snapshotId} stays queued for a later attempt.`,
        );
        this.isProcessing = false;
        return;
      }

      // Process the snapshot
      await this.indexSnapshot(snapshotId);

      // Mark as indexed only after `indexSnapshot` resolved: a failed upsert
      // must leave the snapshot eligible for a retry.
      this.indexedSnapshots.add(snapshotId);
      await this.persistIndexedSnapshots();

      log(`Completed indexing snapshot ${snapshotId}`);
    } catch (error) {
      log(`Error processing snapshot ${snapshotId}: ${error}`);
    } finally {
      // Every exit from the pass -- including the missing-credentials return --
      // releases the in-flight id.
      this.inFlightSnapshotId = undefined;
    }

    if (this.disposed) {
      this.isProcessing = false;
      return;
    }

    // Process next
    void this.processNextSnapshot();
  }

  /**
   * Persist the indexed-snapshot set, unless the service is disposed. The
   * writes are the part of an in-flight chain that changes state after
   * `dispose()`, which an unloading extension must not be doing.
   */
  private async persistIndexedSnapshots(): Promise<void> {
    if (this.disposed) {
      return;
    }
    await this.context.workspaceState.update(
      'semanticSearch.indexedSnapshots',
      Array.from(this.indexedSnapshots),
    );
  }

  /**
   * Make sure specified snapshots are indexed
   */

  /**
   * Process and index a snapshot
   */
  private async indexSnapshot(snapshotId: string): Promise<void> {
    const snapshot = this.snapshotManager.getSnapshotById(snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot ${snapshotId} not found`);
    }

    // Get all files in the snapshot
    const allFiles = Object.keys(snapshot.files);

    // Gather all chunks
    const allChunks: CodeChunk[] = [];

    // Process each file
    for (const filePath of allFiles) {
      const fileData = snapshot.files[filePath];

      // Skip deleted files
      if (fileData.deleted) {
        continue;
      }

      // Skip binary files
      if (fileData.isBinary) {
        continue;
      }

      try {
        // Get file content - pass forIndexing=true to prevent opening in editor
        const content = await this.snapshotManager.getSnapshotFileContentPublic(
          snapshotId,
          filePath,
          true, // Set forIndexing to true to prevent VS Code from showing the file
        );

        if (!content) {
          logVerbose(`No content for ${filePath} in snapshot ${snapshotId}`);
          continue;
        }

        // Chunk the file
        const fileChunks = await this.codeChunker.chunkFile(
          filePath,
          content,
          snapshotId,
        );

        allChunks.push(...fileChunks);
      } catch (error) {
        log(`Error processing file ${filePath} for indexing: ${error}`);
      }
    }

    if (allChunks.length === 0) {
      log(`No valid chunks found for snapshot ${snapshotId}`);
      return;
    }

    log(`Generated ${allChunks.length} chunks for snapshot ${snapshotId}`);

    // Generate embeddings
    const embeddings = await this.embeddingService.embedCodeChunks(allChunks);

    // Store vectors
    await this.vectorDatabaseService.upsertVectors(
      snapshotId,
      allChunks,
      embeddings,
    );
  }

  /**
   * Handle snapshot deletion
   *
   * Order matters: the vector store is cleared *first*. Purging the in-memory
   * set first meant a failed store delete left the extension believing the
   * snapshot was de-indexed while its vectors stayed searchable forever --
   * consuming topK slots on hits that were then discarded. Failing before the
   * bookkeeping leaves the snapshot marked as indexed so a later attempt can
   * retry, and the error is propagated for the caller to report.
   *
   * A skipped purge is bookkeeping, not a failure: the vectors were never
   * there, so the snapshot is removed from the index record and the skip is
   * logged.
   */
  async deleteSnapshotIndexing(snapshotId: string): Promise<void> {
    const purge = await this.vectorDatabaseService.deleteSnapshotVectors(
      snapshotId,
    );
    if (!purge.purged) {
      log(
        `Snapshot ${snapshotId} removed from the search index bookkeeping without a vector purge (${purge.skippedReason}).`,
      );
    }

    // The cache holds whole vectors -- about 24 MB at 3072 dimensions -- keyed
    // by content hash, and nothing else ever released them, so a purged
    // snapshot stayed resident for the life of the window.
    this.embeddingService.clearCache();

    this.indexedSnapshots.delete(snapshotId);
    // Persist removal
    await this.persistIndexedSnapshots();

    // Remove from queue if present
    const queueIndex = this.processingQueue.indexOf(snapshotId);
    if (queueIndex !== -1) {
      this.processingQueue.splice(queueIndex, 1);
    }

    log(`Removed indexing for snapshot ${snapshotId}`);
  }

  /**
   * Index snapshots.
   *
   * With no options this means every snapshot that is not already recorded in
   * indexedSnapshots -- the behaviour every existing caller relies on. An
   * explicit snapshotIds list selects exactly those; force includes ones already
   * indexed; purgeFirst clears a snapshot's vectors before upserting so a retry
   * cannot mix old and new chunk ids.
   */
  async indexAllSnapshots(
    options: {
      snapshotIds?: string[];
      force?: boolean;
      purgeFirst?: boolean;
    } = {},
  ): Promise<IndexingOutcome> {
    const snapshots = this.snapshotManager.getSnapshots();
    const requested = (options.snapshotIds ?? []).filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );

    if (snapshots.length === 0 && requested.length === 0) {
      return { attempted: 0, succeeded: 0, failed: [] };
    }

    // Ensure credentials are set up
    const hasCredentials = await this.credentialsManager.hasCredentials();
    if (!hasCredentials) {
      const credentialsSet =
        await this.credentialsManager.promptForCredentials();
      if (!credentialsSet) {
        throw new Error('API credentials required for semantic indexing');
      }
    }

    return vscode.window.withProgress<IndexingOutcome>(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Indexing snapshots for semantic search',
        cancellable: true,
      },
      async (progress, token) => {
        const failed: Array<{ snapshotId: string; error: string }> = [];
        const known = new Set(snapshots.map((snapshot) => snapshot.id));

        // Absent or empty ids mean every snapshot; explicit ids mean exactly
        // those. An id that does not exist is reported, never dropped.
        const selected =
          requested.length > 0 ? requested : snapshots.map((s) => s.id);
        const targets: string[] = [];
        for (const snapshotId of selected) {
          if (!known.has(snapshotId)) {
            failed.push({
              snapshotId,
              error: 'Snapshot ' + snapshotId + ' not found',
            });
            continue;
          }
          if (options.force !== true && this.indexedSnapshots.has(snapshotId)) {
            continue;
          }
          targets.push(snapshotId);
        }

        if (targets.length === 0 && failed.length === 0) {
          vscode.window.showInformationMessage(
            requested.length > 0
              ? 'The requested snapshots are already indexed.'
              : 'All snapshots are already indexed.',
          );
          return { attempted: 0, succeeded: 0, failed: [] };
        }

        const total = targets.length;
        // `attempted` counts every snapshot the run tried, including requested
        // ids that do not exist; `processed` counts only the snapshots the loop
        // is actually working on, so the progress text cannot claim to be on
        // snapshot 2 of 1 when a missing id is seeded into `attempted`.
        let attempted = failed.length;
        let processed = 0;
        let succeeded = 0;

        // Process snapshots sequentially, checking cancellation at each
        // boundary. The previous implementation registered a listener that
        // showed a toast but could not stop the loop, so a cancelled run still
        // ran to completion.
        for (const snapshotId of targets) {
          throwIfCancelled(token);

          progress.report({
            message: 'Processing snapshot ' + (processed + 1) + ' of ' + total,
            increment: 100 / total,
          });
          processed++;
          attempted++;

          // Whether this snapshot's vectors may already be gone if a later step
          // of the same try block throws. Only entering `indexSnapshot` sets it:
          // its upsert purges the snapshot's vectors before it writes any batch
          // (plan 11), and that purge runs after `ensureInitialized`, which can
          // create the index and obtain the credentials the explicit `--purge`
          // below deliberately refuses to prompt for. A purge the explicit call
          // *skipped* can therefore still have happened by the time
          // `indexSnapshot` throws.
          //
          // The explicit purge is deliberately not part of this flag: if it
          // throws, it never reached the store, the vectors are intact and the
          // mark must survive. Its outcome is not consulted here any more
          // either - `indexSnapshot` may purge after a skip just as it may
          // after a delete, so the outcome cannot change the decision.
          let vectorsMayBeGone = false;
          try {
            if (options.purgeFirst === true) {
              // A re-index without this mixes the old and the new chunk id sets
              // for the same snapshot. Plan 11 also makes the upsert itself
              // idempotent; this call stays correct either way.
              await this.vectorDatabaseService.deleteSnapshotVectors(
                snapshotId,
              );
            }

            // Over-dropping is the safe direction: it costs one unnecessary
            // re-index on the next run, where keeping the mark would let a later
            // non-forced run report 'already indexed' over an empty store.
            vectorsMayBeGone = true;
            await this.indexSnapshot(snapshotId);
            this.indexedSnapshots.add(snapshotId);
            // Persist updated indexed snapshots
            await this.persistIndexedSnapshots();
            succeeded++;
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            failed.push({ snapshotId, error: message });
            if (vectorsMayBeGone) {
              // The vectors may be gone but the snapshot was not re-indexed, so
              // a persisted mark would make every later selection skip it and
              // report it as already indexed over an empty store. Forget it so
              // the next run retries. Guarded on the regions that can have
              // deleted vectors, not on purgeFirst: if the explicit purge
              // itself threw, it never reached the store and the mark stays.
              this.indexedSnapshots.delete(snapshotId);
              // The correction is best-effort: if the persist itself is what
              // failed, a second throw here would escape the catch, abort every
              // remaining snapshot and lose this run's failure report. The
              // in-memory set is corrected either way.
              try {
                await this.persistIndexedSnapshots();
              } catch (persistError) {
                log(
                  `Error persisting the corrected indexed set: ${
                    persistError instanceof Error
                      ? persistError.message
                      : String(persistError)
                  }`,
                );
              }
            }
            log(`Error indexing snapshot ${snapshotId}: ${message}`);
          }
        }

        if (failed.length === 0) {
          vscode.window.showInformationMessage(
            `Indexed ${succeeded} snapshot(s) for semantic search.`,
          );
        } else if (succeeded === 0) {
          vscode.window.showErrorMessage(
            `Indexing failed for all ${failed.length} snapshot(s). See the CodeLapse output channel for details.`,
          );
        } else {
          vscode.window.showWarningMessage(
            `Indexed ${succeeded} of ${
              failed.length + succeeded
            } snapshot(s); ${
              failed.length
            } failed. See the CodeLapse output channel for details.`,
          );
        }

        return { attempted, succeeded, failed };
      },
    );
  }

  /**
   * Get the root path of the workspace
   * @returns The workspace root path, or undefined if no workspace is open
   */
  getWorkspaceRoot(): string | undefined {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return undefined;
    }
    return workspaceFolders[0].uri.fsPath;
  }

  // ============================================================================
  // Enhanced Search Helper Methods
  // ============================================================================

  /**
   * Enhance query for behavioral search
   */

  /**
   * Enhance query for syntactic search
   */

  /**
   * Get boost factors based on query intent
   */

  /**
   * Get penalty factors based on query intent.
   *
   * Returns none, deliberately. This method registered `hasCodeSmells` for
   * `find_examples`, and nothing evaluates that condition: `evaluateCondition`
   * on `ResultManager` has no case for it, so it fell through to its documented
   * `default: false`. The registration was deleted from the live strategy
   * builder (`queryProcessor.ts:getPenaltyFactors`) for the same reason -- a
   * registration against a condition that cannot fire is configuration reading
   * as a working safety net -- and this copy is not even reachable: no caller
   * exists for this method. It can come back when a smell signal does; see
   * docs/KNOWN_ISSUES.md, "Every penalty condition is unreachable".
   */

  /**
   * Get expected result types based on intent
   */

  /**
   * Calculate query complexity score
   */

  /**
   * Generate result explanation
   */

  /**
   * Extract key features from code content
   */
  private extractKeyFeatures(content: string): string[] {
    const features = [];

    // Function definitions
    if (/function\s+\w+|def\s+\w+|const\s+\w+\s*=/.test(content)) {
      features.push('Function definition');
    }

    // Class definitions
    if (/class\s+\w+|interface\s+\w+/.test(content)) {
      features.push('Class or interface definition');
    }

    // Error handling
    if (/try\s*{|catch\s*\(|except\s*:/.test(content)) {
      features.push('Error handling');
    }

    // API calls
    if (/fetch\(|axios\.|http\.|request\(/.test(content)) {
      features.push('API calls');
    }

    // Database operations
    if (/SELECT|INSERT|UPDATE|DELETE|query\(/.test(content)) {
      features.push('Database operations');
    }

    return features;
  }

  /**
   * Find matched concepts between content and query
   */
  private findMatchedConcepts(content: string, query: string): string[] {
    const queryWords = query.toLowerCase().split(/\s+/);
    const contentLower = content.toLowerCase();
    const matched = [];

    for (const word of queryWords) {
      if (word.length > 3 && contentLower.includes(word)) {
        matched.push(word);
      }
    }

    return matched;
  }

  /**
   * Get default quality metrics
   */
  private getDefaultQualityMetrics() {
    return { ...DEFAULT_QUALITY_METRICS };
  }

  /**
   * Generate context info for a result
   */
  private async generateContextInfo(
    result: SemanticSearchResult,
    contextRadius: number,
  ) {
    // Get surrounding context
    const content = await this.snapshotManager.getSnapshotFileContentPublic(
      result.snapshotId,
      result.filePath,
    );

    if (!content) {
      return {
        surroundingContext: '',
        architecturalLayer: 'unknown',
        frameworkContext: [],
      };
    }

    const lines = content.split('\n');
    const startContext = Math.max(0, result.startLine - contextRadius);
    const endContext = Math.min(
      lines.length - 1,
      result.endLine + contextRadius,
    );
    const surroundingContext = lines
      .slice(startContext, endContext + 1)
      .join('\n');

    return {
      surroundingContext,
      architecturalLayer: this.detectArchitecturalLayer(result.filePath) as any,
      frameworkContext: this.detectFrameworks(content),
      fileContext: {
        totalLines: content.split('\n').length,
        fileSize: content.length,
        lastModified: new Date(result.timestamp),
        encoding: 'utf-8',
        siblingChunks: [],
      },
    };
  }

  /**
   * Detect architectural layer from file path
   */
  private detectArchitecturalLayer(filePath: string): string {
    if (/\/(controller|api|endpoint)s?\//.test(filePath)) return 'presentation';
    if (/\/(service|business|domain)s?\//.test(filePath)) return 'business';
    if (/\/(repository|dao|data)s?\//.test(filePath)) return 'data';
    if (/\/(model|entity)s?\//.test(filePath)) return 'model';
    if (/\/(util|helper|common)s?\//.test(filePath)) return 'utility';
    if (/\/(test|spec)s?\//.test(filePath)) return 'test';
    return 'unknown';
  }

  /**
   * Detect frameworks from content
   */
  private detectFrameworks(content: string): string[] {
    const frameworks = [];

    if (/import.*react|from ['"]react['"]/.test(content))
      frameworks.push('React');
    if (/import.*vue|from ['"]vue['"]/.test(content)) frameworks.push('Vue');
    if (/import.*angular|from ['"]@angular/.test(content))
      frameworks.push('Angular');
    if (/import.*express|from ['"]express['"]/.test(content))
      frameworks.push('Express');
    if (/import.*lodash|from ['"]lodash['"]/.test(content))
      frameworks.push('Lodash');

    return frameworks;
  }

  /**
   * Generate actionable suggestions
   */

  /**
   * Find alternative results
   */

  /**
   * Create enhanced metadata
   */

  /**
   * Detect semantic type of code
   */
  private detectSemanticType(
    content: string,
  ):
    | 'function'
    | 'class'
    | 'interface'
    | 'module'
    | 'config'
    | 'test'
    | 'documentation' {
    if (/describe\(|it\(|test\(|expect\(/.test(content)) return 'test';
    if (/class\s+\w+/.test(content)) return 'class';
    if (/interface\s+\w+/.test(content)) return 'interface';
    if (/function\s+\w+|const\s+\w+\s*=/.test(content)) return 'function';
    if (/module\.exports|export\s+(default\s+)?{/.test(content))
      return 'module';
    if (
      /\/\*\*|\/\//.test(content) &&
      content.split('\n').filter((l) => l.trim().startsWith('//')).length > 5
    )
      return 'documentation';
    return 'function';
  }

  /**
   * Detect design patterns
   */
  private detectDesignPatterns(content: string): string[] {
    const patterns = [];

    if (
      /class\s+\w*Singleton/.test(content) ||
      /getInstance\(\)/.test(content)
    ) {
      patterns.push('Singleton');
    }
    if (/class\s+\w*Factory/.test(content) || /create\w*\(\)/.test(content)) {
      patterns.push('Factory');
    }
    if (
      /class\s+\w*Observer/.test(content) ||
      /subscribe|notify|observer/.test(content)
    ) {
      patterns.push('Observer');
    }

    return patterns;
  }

  /**
   * Detect business domain
   */
  private detectBusinessDomain(filePath: string): string | undefined {
    if (/\/(auth|login|user)/.test(filePath)) return 'Authentication';
    if (/\/(payment|billing|invoice)/.test(filePath)) return 'Payment';
    if (/\/(order|cart|checkout)/.test(filePath)) return 'E-commerce';
    if (/\/(report|analytics|dashboard)/.test(filePath)) return 'Analytics';
    return undefined;
  }

  /**
   * Extract dependencies from code
   */
  private extractDependencies(content: string): string[] {
    const deps = [];
    const importMatches = content.match(/import.*from ['"]([^'"]+)['"]/g);

    if (importMatches) {
      for (const match of importMatches) {
        const depMatch = match.match(/from ['"]([^'"]+)['"]/);
        if (depMatch) {
          deps.push(depMatch[1]);
        }
      }
    }

    return deps;
  }

  /**
   * Calculate cyclomatic complexity (simplified)
   */
  private calculateCyclomaticComplexity(content: string): number {
    const decisionPoints = (
      content.match(/if\s*\(|while\s*\(|for\s*\(|case\s+|catch\s*\(/g) || []
    ).length;
    return decisionPoints + 1;
  }

  /**
   * Calculate cognitive complexity (simplified)
   */
  private calculateCognitiveComplexity(content: string): number {
    let complexity = 0;
    const lines = content.split('\n');
    let nestingLevel = 0;

    for (const line of lines) {
      if (/if\s*\(|while\s*\(|for\s*\(/.test(line)) {
        complexity += 1 + nestingLevel;
        nestingLevel++;
      }
      if (line.includes('{')) nestingLevel++;
      if (line.includes('}')) nestingLevel = Math.max(0, nestingLevel - 1);
    }

    return complexity;
  }

  /**
   * Calculate nesting depth
   */
  private calculateNestingDepth(content: string): number {
    let maxDepth = 0;
    let currentDepth = 0;

    for (const char of content) {
      if (char === '{') {
        currentDepth++;
        maxDepth = Math.max(maxDepth, currentDepth);
      } else if (char === '}') {
        currentDepth = Math.max(0, currentDepth - 1);
      }
    }

    return maxDepth;
  }

  /**
   * Analyze security considerations
   */
  private analyzeSecurityConsiderations(
    content: string,
  ): SecurityConsideration[] {
    const considerations: SecurityConsideration[] = [];

    // SQL injection risk
    if (/query\s*\+|SELECT.*\+/.test(content)) {
      considerations.push({
        type: 'vulnerability',
        severity: 'high',
        description: 'Potential SQL injection vulnerability detected',
        recommendation:
          'Use parameterized queries instead of string concatenation',
      });
    }

    // XSS risk
    if (/innerHTML\s*=|document\.write/.test(content)) {
      considerations.push({
        type: 'vulnerability',
        severity: 'medium',
        description: 'Potential XSS vulnerability detected',
        recommendation: 'Sanitize user input before rendering',
      });
    }

    return considerations;
  }

  /**
   * Rank and filter enhanced results
   */

  /**
   * Apply filters to results
   */
  private applyFilters(
    results: EnhancedSemanticSearchResult[],
    filters: any,
  ): EnhancedSemanticSearchResult[] {
    return results.filter((result) => {
      // Quality threshold filter
      if (
        filters.qualityThreshold &&
        toRatio(result.qualityMetrics.readabilityScore) <
          filters.qualityThreshold
      ) {
        return false;
      }

      // Complexity range filter
      if (filters.complexityRange) {
        const complexity =
          result.enhancedMetadata.complexityMetrics.cyclomaticComplexity;
        if (
          complexity < filters.complexityRange[0] ||
          complexity > filters.complexityRange[1]
        ) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Apply ranking strategy
   */
  private applyRanking(
    results: EnhancedSemanticSearchResult[],
    strategy: RankingStrategy,
  ): EnhancedSemanticSearchResult[] {
    return results.sort((a, b) => {
      switch (strategy) {
        case 'quality':
          // Both operands are readabilityScore, both 0-100: this is a sort
          // comparator, so only the sign matters and no conversion is involved.
          // quality-scale: same-unit
          return (
            b.qualityMetrics.readabilityScore -
            a.qualityMetrics.readabilityScore
          );
        case 'recency':
          return b.timestamp - a.timestamp;
        case 'relevance':
        default:
          return b.score - a.score;
      }
    });
  }

  /**
   * Apply diversification to results
   */
  private applyDiversification(
    results: EnhancedSemanticSearchResult[],
    options: EnhancedSemanticSearchOptions,
  ): EnhancedSemanticSearchResult[] {
    const maxPerFile = options.maxResultsPerFile || 3;
    const fileCount = new Map<string, number>();
    const diversified = [];

    for (const result of results) {
      const fileKey = `${result.snapshotId}:${result.filePath}`;
      const count = fileCount.get(fileKey) || 0;

      if (count < maxPerFile) {
        diversified.push(result);
        fileCount.set(fileKey, count + 1);
      }
    }

    return diversified;
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    // Set the flag first: anything already in flight checks it before its next
    // write, and the queue is cleared so nothing new starts.
    this.disposed = true;
    this.snapshotChangeSubscription?.dispose();
    this.snapshotChangeSubscription = undefined;
    this.processingQueue = [];
    this.isProcessing = false;
    this.performanceMetrics.clear();
    log('Disposed semantic search service');
  }

  /**
   * Calculate quality metrics for a search result
   */

  /**
   * Analyze relationships for a search result
   */

  /**
   * Generate basic context info for a result
   */

  /**
   * Create an enhanced chunk from a search result
   */
  private createEnhancedChunkFromResult(result: SemanticSearchResult) {
    const language = this.detectLanguageFromFilePath(result.filePath);
    const linesOfCode = this.calculateLinesOfCode(result.content);

    return {
      id: `${result.snapshotId}:${result.filePath}:${result.startLine}`,
      snapshotId: result.snapshotId,
      content: result.content,
      filePath: result.filePath,
      startLine: result.startLine,
      endLine: result.endLine,
      metadata: {
        language,
        symbols: this.extractSymbols(result.content, language),
        imports: this.extractImports(result.content, language),
        exports: this.extractExports(result.content, language),
        startLine: result.startLine,
        endLine: result.endLine,
        chunkSize: result.content.length,
        chunkType: 'semantic',
      },
      enhancedMetadata: {
        language,
        semanticType: this.detectSemanticType(result.content),
        complexityScore: this.calculateSimpleComplexity(result.content),
        maintainabilityIndex: 70,
        dependencies: this.extractImports(result.content, language),
        dependents: [],
        designPatterns: [],
        codeSmells: [],
        securityConcerns: [],
        linesOfCode,
        symbols: this.extractSymbols(result.content, language),
      },
      relationships: [],
      qualityMetrics: this.getDefaultQualityMetrics(),
      contextInfo: {
        surroundingContext: '',
        architecturalLayer: 'unknown' as const,
        frameworkContext: [],
        fileContext: {
          totalLines: result.content.split('\n').length,
          fileSize: result.content.length,
          lastModified: new Date(result.timestamp),
          encoding: 'utf-8',
          siblingChunks: [],
        },
      },
    };
  }

  /**
   * Detect language from file path
   */
  private detectLanguageFromFilePath(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
      js: 'javascript',
      jsx: 'javascript',
      ts: 'typescript',
      tsx: 'typescript',
      py: 'python',
      java: 'java',
      cpp: 'cpp',
      c: 'c',
      cs: 'csharp',
      php: 'php',
      rb: 'ruby',
      go: 'go',
      rs: 'rust',
      kt: 'kotlin',
      swift: 'swift',
    };
    return languageMap[ext || ''] || 'unknown';
  }

  /**
   * Calculate lines of code metrics
   */
  private calculateLinesOfCode(content: string) {
    const lines = content.split('\n');
    let code = 0;
    let comments = 0;
    let blank = 0;
    let mixed = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '') {
        blank++;
      } else if (
        trimmed.startsWith('//') ||
        trimmed.startsWith('#') ||
        trimmed.startsWith('/*')
      ) {
        comments++;
      } else if (trimmed.includes('//') || trimmed.includes('#')) {
        mixed++;
      } else {
        code++;
      }
    }

    return {
      total: lines.length,
      code,
      comments,
      blank,
      mixed,
      logical: code + mixed,
    };
  }

  /**
   * Extract symbols from code content
   */
  private extractSymbols(content: string, language: string): string[] {
    const symbols: string[] = [];

    // Simple symbol extraction based on language
    switch (language) {
      case 'javascript':
      case 'typescript': {
        // Extract function names, class names, variable names
        const jsMatches = content.match(
          /(?:function\s+|class\s+|const\s+|let\s+|var\s+)(\w+)/g,
        );
        if (jsMatches) {
          jsMatches.forEach((match) => {
            const symbol = match.split(/\s+/).pop();
            if (symbol) symbols.push(symbol);
          });
        }
        break;
      }
      case 'python': {
        const pyMatches = content.match(/(?:def\s+|class\s+)(\w+)/g);
        if (pyMatches) {
          pyMatches.forEach((match) => {
            const symbol = match.split(/\s+/).pop();
            if (symbol) symbols.push(symbol);
          });
        }
        break;
      }
      case 'java': {
        const javaMatches = content.match(
          /(?:public\s+|private\s+|protected\s+)?(?:static\s+)?(?:class\s+|interface\s+|\w+\s+)(\w+)/g,
        );
        if (javaMatches) {
          javaMatches.forEach((match) => {
            const symbol = match.split(/\s+/).pop();
            if (symbol) symbols.push(symbol);
          });
        }
        break;
      }
    }

    return [...new Set(symbols)]; // Remove duplicates
  }

  /**
   * Extract imports from code content
   */
  private extractImports(content: string, language: string): string[] {
    const imports: string[] = [];

    switch (language) {
      case 'javascript':
      case 'typescript': {
        const jsImports = content.match(
          /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g,
        );
        if (jsImports) {
          jsImports.forEach((imp) => {
            const match = imp.match(/from\s+['"]([^'"]+)['"]/);
            if (match) imports.push(match[1]);
          });
        }
        break;
      }
      case 'python': {
        const pyImports = content.match(
          /(?:from\s+(\S+)\s+import|import\s+(\S+))/g,
        );
        if (pyImports) {
          pyImports.forEach((imp) => {
            const fromMatch = imp.match(/from\s+(\S+)\s+import/);
            const importMatch = imp.match(/import\s+(\S+)/);
            if (fromMatch) imports.push(fromMatch[1]);
            if (importMatch) imports.push(importMatch[1]);
          });
        }
        break;
      }
      case 'java': {
        const javaImports = content.match(/import\s+([^;]+);/g);
        if (javaImports) {
          javaImports.forEach((imp) => {
            const match = imp.match(/import\s+([^;]+);/);
            if (match) imports.push(match[1]);
          });
        }
        break;
      }
    }

    return [...new Set(imports)];
  }

  /**
   * Extract exports from code content
   */
  private extractExports(content: string, language: string): string[] {
    const exports: string[] = [];

    switch (language) {
      case 'javascript':
      case 'typescript': {
        const jsExports = content.match(
          /export\s+(?:default\s+)?(?:class\s+|function\s+|const\s+|let\s+|var\s+)?(\w+)/g,
        );
        if (jsExports) {
          jsExports.forEach((exp) => {
            const match = exp.match(/(\w+)$/);
            if (match) exports.push(match[1]);
          });
        }
        break;
      }
      case 'python': {
        // Python doesn't have explicit exports, but we can look for __all__
        const allMatch = content.match(/__all__\s*=\s*\[(.*?)\]/s);
        if (allMatch) {
          const items = allMatch[1].match(/'([^']+)'|"([^"]+)"/g);
          if (items) {
            items.forEach((item) => {
              const cleaned = item.replace(/['"]/g, '');
              exports.push(cleaned);
            });
          }
        }
        break;
      }
      case 'java': {
        // Java exports are implicit through public classes/methods
        const publicClasses = content.match(/public\s+class\s+(\w+)/g);
        if (publicClasses) {
          publicClasses.forEach((cls) => {
            const match = cls.match(/class\s+(\w+)/);
            if (match) exports.push(match[1]);
          });
        }
        break;
      }
    }

    return [...new Set(exports)];
  }

  /**
   * Calculate simple complexity score
   */
  private calculateSimpleComplexity(content: string): number {
    const complexityKeywords = [
      'if',
      'else',
      'for',
      'while',
      'switch',
      'case',
      'try',
      'catch',
    ];
    let complexity = 1; // Base complexity

    complexityKeywords.forEach((keyword) => {
      const regex = new RegExp(`\\b${keyword}\\b`, 'g');
      const matches = content.match(regex);
      if (matches) {
        complexity += matches.length;
      }
    });

    return Math.min(100, complexity * 5); // Scale to 0-100
  }
}
