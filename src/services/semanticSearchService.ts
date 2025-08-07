import * as vscode from 'vscode';
import { log, logVerbose } from '../logger';
import { SnapshotManager, Snapshot } from '../snapshotManager';
import { CredentialsManager } from './credentialsManager';
import { CodeChunker, CodeChunk } from './codeChunker';
import { EmbeddingService } from './embeddingService';
import { VectorDatabaseService, SearchResult } from './vectorDatabaseService';
import {
  EnhancedSemanticSearchOptions,
  EnhancedSemanticSearchResult,
  SearchMode,
  RankingStrategy,
  ProcessedQuery,
  QueryIntent,
  SearchStrategy,
  SearchResultExplanation,
  ConfidenceFactor,
  ActionableSuggestion,
  AlternativeResult,
  EnhancedResultMetadata,
  ComplexityMetrics,
  SecurityConsideration,
  AIAgentResponse,
  ResponseMetadata,
  ResponseSuggestion,
  PerformanceMetrics,
  SearchQualityMetrics,
} from '../types/enhancedSearch';
import { EnhancedCodeChunker } from './enhancedCodeChunker';
import { QualityMetricsCalculator } from './qualityMetricsCalculator';
import { RelationshipAnalyzer } from './relationshipAnalyzer';
import { QueryProcessor, QueryContext } from './queryProcessor';
import { ResultManager } from './resultManager';

export interface SemanticSearchOptions {
  query: string;
  snapshotIds?: string[];
  limit?: number;
  languages?: string[];
  scoreThreshold?: number;
}

export interface SemanticSearchResult {
  snapshotId: string;
  snapshot: Snapshot;
  filePath: string;
  startLine: number;
  endLine: number;
  score: number;
  content: string;
  timestamp: number;
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
  private qualityMetricsCalculator: QualityMetricsCalculator;
  private relationshipAnalyzer: RelationshipAnalyzer;
  private queryProcessor: QueryProcessor;
  private resultManager: ResultManager;

  // Background processing
  private processingQueue: string[] = []; // Queue of snapshot IDs to process
  private isProcessing = false;

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
    this.vectorDatabaseService = new VectorDatabaseService(credentialsManager);

    // Initialize enhanced services for AI agent optimization
    this.enhancedCodeChunker = new EnhancedCodeChunker();
    this.qualityMetricsCalculator = new QualityMetricsCalculator();
    this.relationshipAnalyzer = new RelationshipAnalyzer();
    this.queryProcessor = new QueryProcessor();
    this.resultManager = new ResultManager();

    this.initialize();

    // Listen for snapshot changes
    this.snapshotManager.onDidChangeSnapshots(() => {
      this.handleSnapshotChanges();
    });
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
        scoreThreshold: Math.max(0.5, scoreThreshold - 0.15), // Slightly lower threshold to get more candidates
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

    // First pass: process all results and enrich with content
    const processedResults: (SemanticSearchResult & { fileKey: string })[] = [];

    for (const result of searchResults) {
      try {
        const snapshot = this.snapshotManager.getSnapshotById(
          result.snapshotId,
        );

        if (!snapshot) {
          logVerbose(
            `Snapshot ${result.snapshotId} not found, skipping result`,
          );
          continue;
        }

        const content = await this.snapshotManager.getSnapshotFileContentPublic(
          result.snapshotId,
          result.filePath,
        );

        if (!content) {
          logVerbose(
            `Content not found for ${result.filePath} in snapshot ${result.snapshotId}`,
          );
          continue;
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

        processedResults.push({
          snapshotId: result.snapshotId,
          snapshot,
          filePath: result.filePath,
          startLine,
          endLine,
          score: result.score,
          content: contentWithContext,
          timestamp: snapshot.timestamp,
          fileKey,
        });
      } catch (error) {
        log(`Error enhancing search result: ${error}`);
      }
    }

    // Sort all processed results by score for the initial ranking
    processedResults.sort((a, b) => b.score - a.score);

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

    // Final sort by score with timestamp as tiebreaker
    enhancedResults.sort((a, b) => {
      // If scores are very close (within 5%), sort by timestamp
      if (Math.abs(a.score - b.score) < 0.05) {
        return b.timestamp - a.timestamp;
      }
      return b.score - a.score;
    });

    // Remove the fileKey property that was used internally
    const finalResults = enhancedResults.map(({ fileKey, ...rest }) => rest);

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
  private classifyQueryIntent(query: string): QueryIntent {
    const lowerQuery = query.toLowerCase();

    // Analyze query patterns to determine intent
    let primary: QueryIntent['primary'] = 'find_implementation';
    const secondary: string[] = [];
    const context: string[] = [];
    let confidence = 0.7;

    // Pattern matching for intent classification
    if (/\b(how to|example|sample|demo)\b/i.test(query)) {
      primary = 'find_examples';
      confidence = 0.9;
      context.push('examples', 'tutorials');
    } else if (/\b(error|bug|issue|problem|fix|debug)\b/i.test(query)) {
      primary = 'debug_issue';
      confidence = 0.85;
      context.push('debugging', 'error_handling');
    } else if (/\b(test|testing|spec|assert|mock)\b/i.test(query)) {
      primary = 'find_implementation';
      secondary.push('testing');
      context.push('testing', 'quality_assurance');
    } else if (/\b(pattern|design|architecture)\b/i.test(query)) {
      primary = 'find_patterns';
      confidence = 0.8;
      context.push('patterns', 'architecture');
    } else if (/\b(usage|used|call|invoke)\b/i.test(query)) {
      primary = 'find_usage';
      confidence = 0.8;
      context.push('usage', 'dependencies');
    } else if (/\b(similar|like|equivalent)\b/i.test(query)) {
      primary = 'find_similar';
      confidence = 0.85;
      context.push('similarity', 'alternatives');
    } else if (/\b(quality|performance|optimize|improve)\b/i.test(query)) {
      primary = 'analyze_quality';
      confidence = 0.8;
      context.push('quality', 'performance');
    }

    return {
      primary,
      secondary,
      confidence,
      context,
      suggestedParameters: {
        searchMode: primary === 'find_patterns' ? 'behavioral' : 'hybrid',
        rankingStrategy:
          primary === 'analyze_quality' ? 'quality' : 'relevance',
        includeQualityMetrics: primary === 'analyze_quality',
        includeRelationships:
          primary === 'find_usage' || primary === 'find_similar',
      },
    };
  }

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

      // Add to processing queue
      this.processingQueue.push(...pendingSnapshots);

      // Start processing if not already processing
      if (!this.isProcessing) {
        this.processNextSnapshot();
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

    try {
      log(`Processing snapshot ${snapshotId} for indexing`);

      // Check if credentials exist
      const hasCredentials = await this.credentialsManager.hasCredentials();
      if (!hasCredentials) {
        log('Semantic search credentials not found. Deferring indexing.');
        this.isProcessing = false;
        return;
      }

      // Process the snapshot
      await this.indexSnapshot(snapshotId);

      // Mark as indexed
      this.indexedSnapshots.add(snapshotId);
      // Persist updated indexed snapshots
      await this.context.workspaceState.update(
        'semanticSearch.indexedSnapshots',
        Array.from(this.indexedSnapshots),
      );

      log(`Completed indexing snapshot ${snapshotId}`);
    } catch (error) {
      log(`Error processing snapshot ${snapshotId}: ${error}`);
    }

    // Process next
    this.processNextSnapshot();
  }

  /**
   * Make sure specified snapshots are indexed
   */
  private async ensureSnapshotsIndexed(snapshotIds: string[]): Promise<void> {
    const unindexedSnapshots = snapshotIds.filter(
      (id) => !this.indexedSnapshots.has(id),
    );

    if (unindexedSnapshots.length === 0) {
      return;
    }

    log(
      `Ensuring ${unindexedSnapshots.length} snapshots are indexed before search`,
    );

    // Process each snapshot sequentially
    for (const snapshotId of unindexedSnapshots) {
      try {
        await this.indexSnapshot(snapshotId);
        this.indexedSnapshots.add(snapshotId);
        // Persist updated indexed snapshots
        await this.context.workspaceState.update(
          'semanticSearch.indexedSnapshots',
          Array.from(this.indexedSnapshots),
        );
      } catch (error) {
        log(`Error indexing snapshot ${snapshotId}: ${error}`);
      }
    }
  }

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
   */
  async deleteSnapshotIndexing(snapshotId: string): Promise<void> {
    try {
      // Remove from indexed set
      this.indexedSnapshots.delete(snapshotId);
      // Persist removal
      await this.context.workspaceState.update(
        'semanticSearch.indexedSnapshots',
        Array.from(this.indexedSnapshots),
      );

      // Remove from queue if present
      const queueIndex = this.processingQueue.indexOf(snapshotId);
      if (queueIndex !== -1) {
        this.processingQueue.splice(queueIndex, 1);
      }

      // Delete from vector database
      await this.vectorDatabaseService.deleteSnapshotVectors(snapshotId);

      log(`Removed indexing for snapshot ${snapshotId}`);
    } catch (error) {
      log(`Error deleting snapshot indexing: ${error}`);
    }
  }

  /**
   * Indexes all existing snapshots
   */
  async indexAllSnapshots(): Promise<void> {
    const snapshots = this.snapshotManager.getSnapshots();

    if (snapshots.length === 0) {
      return;
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

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Indexing snapshots for semantic search',
        cancellable: true,
      },
      async (progress, token) => {
        // Set up cancellation handler
        token.onCancellationRequested(() => {
          this.processingQueue = [];
          vscode.window.showInformationMessage('Indexing cancelled.');
        });

        // Filter to non-indexed snapshots
        const unindexedSnapshots = snapshots
          .filter((snapshot) => !this.indexedSnapshots.has(snapshot.id))
          .map((snapshot) => snapshot.id);

        if (unindexedSnapshots.length === 0) {
          vscode.window.showInformationMessage(
            'All snapshots are already indexed.',
          );
          return;
        }

        const total = unindexedSnapshots.length;
        let current = 0;

        // Process snapshots sequentially with cancellation support
        for (const snapshotId of unindexedSnapshots) {
          if (token.isCancellationRequested) {
            throw new Error('Indexing cancelled by user');
          }
          progress.report({
            message: `Processing snapshot ${++current} of ${total}`,
            increment: 100 / total,
          });
          try {
            await this.indexSnapshot(snapshotId);
            this.indexedSnapshots.add(snapshotId);
            // Persist updated indexed snapshots
            await this.context.workspaceState.update(
              'semanticSearch.indexedSnapshots',
              Array.from(this.indexedSnapshots),
            );
          } catch (error) {
            log(`Error indexing snapshot ${snapshotId}: ${error}`);
          }
        }

        if (!token.isCancellationRequested) {
          vscode.window.showInformationMessage(
            `Successfully indexed ${current} snapshots for semantic search.`,
          );
        }
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
  private enhanceForBehavioralSearch(query: string): string {
    return `${query} behavior functionality what does this code do`;
  }

  /**
   * Enhance query for syntactic search
   */
  private enhanceForSyntacticSearch(query: string): string {
    return `${query} syntax structure pattern`;
  }

  /**
   * Get boost factors based on query intent
   */
  private getBoostFactors(intent: QueryIntent) {
    const factors = [];

    if (intent.primary === 'find_examples') {
      factors.push({
        condition: 'hasTests',
        multiplier: 1.3,
        description: 'Boost code with tests for examples',
        weight: 0.8,
      });
    }

    if (intent.primary === 'analyze_quality') {
      factors.push({
        condition: 'highQuality',
        multiplier: 1.5,
        description: 'Boost high-quality code for quality analysis',
        weight: 0.9,
      });
    }

    return factors;
  }

  /**
   * Get penalty factors based on query intent
   */
  private getPenaltyFactors(intent: QueryIntent) {
    const factors = [];

    if (intent.primary === 'find_examples') {
      factors.push({
        condition: 'hasCodeSmells',
        multiplier: 0.7,
        description: 'Penalize code with smells for examples',
        weight: 0.6,
      });
    }

    return factors;
  }

  /**
   * Get expected result types based on intent
   */
  private getExpectedResultTypes(intent: QueryIntent): string[] {
    switch (intent.primary) {
      case 'find_implementation':
        return ['function', 'class', 'method'];
      case 'find_examples':
        return ['function', 'class', 'test'];
      case 'find_patterns':
        return ['class', 'interface', 'module'];
      case 'find_usage':
        return ['function', 'method', 'call'];
      case 'analyze_quality':
        return ['function', 'class', 'module'];
      default:
        return ['function', 'class'];
    }
  }

  /**
   * Calculate query complexity score
   */
  private calculateQueryComplexity(query: string): number {
    let complexity = 0.5; // Base complexity

    // Length factor
    if (query.length > 100) complexity += 0.3;
    else if (query.length > 50) complexity += 0.2;

    // Technical terms
    const technicalTerms =
      /\b(algorithm|pattern|architecture|performance|optimization|security)\b/gi;
    const matches = query.match(technicalTerms);
    if (matches) complexity += matches.length * 0.1;

    // Multiple conditions
    if (query.includes(' AND ') || query.includes(' OR ')) complexity += 0.2;

    return Math.min(1.0, complexity);
  }

  /**
   * Generate result explanation
   */
  private async generateResultExplanation(
    result: SemanticSearchResult,
    processedQuery: ProcessedQuery,
  ): Promise<SearchResultExplanation> {
    const keyFeatures = this.extractKeyFeatures(result.content);
    const matchedConcepts = this.findMatchedConcepts(
      result.content,
      processedQuery.originalQuery,
    );

    return {
      whyRelevant: `This code matches your query "${
        processedQuery.originalQuery
      }" with a confidence score of ${(result.score * 100).toFixed(1)}%`,
      keyFeatures,
      matchedConcepts,
      confidenceFactors: [
        {
          factor: 'semantic_similarity',
          weight: 0.7,
          description: 'Semantic similarity to query',
          value: result.score,
        },
        {
          factor: 'keyword_match',
          weight: 0.3,
          description: 'Keyword matching',
          value: matchedConcepts.length > 0 ? 0.8 : 0.3,
        },
      ],
      semanticSimilarity: `High semantic similarity (${(
        result.score * 100
      ).toFixed(1)}%) based on code functionality and context`,
    };
  }

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
    return {
      overallScore: 70,
      readabilityScore: 0.7,
      testCoverage: 0,
      documentationRatio: 0.5,
      duplicationRisk: 0.3,
      performanceRisk: 0.2,
      securityRisk: 0.2,
      maintainabilityScore: 70,
      technicalDebt: {
        estimatedFixTime: 0,
        severity: 'low' as const,
        categories: [],
        issues: [],
      },
      styleComplianceScore: 80,
    };
  }

  /**
   * Generate context info for a result
   */
  private async generateContextInfo(
    result: SemanticSearchResult,
    contextRadius: number,
  ) {
    // Get surrounding context
    const snapshot = result.snapshot;
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
  private async generateActionableSuggestions(
    result: SemanticSearchResult,
    qualityMetrics: any,
  ): Promise<ActionableSuggestion[]> {
    const suggestions: ActionableSuggestion[] = [];

    // Quality-based suggestions
    if (qualityMetrics.readabilityScore < 0.6) {
      suggestions.push({
        type: 'improvement',
        description:
          'Consider improving code readability with better variable names and comments',
        priority: 'medium',
        effort: 'moderate',
        action: 'Refactor for readability',
        expectedBenefit: 'Improved maintainability',
      });
    }

    if (qualityMetrics.testCoverage === 0) {
      suggestions.push({
        type: 'testing',
        description: 'Add unit tests to improve code reliability',
        priority: 'high',
        effort: 'moderate',
        action: 'Write unit tests',
        expectedBenefit: 'Better code reliability and regression prevention',
      });
    }

    return suggestions;
  }

  /**
   * Find alternative results
   */
  private async findAlternativeResults(
    result: SemanticSearchResult,
    allResults: SemanticSearchResult[],
  ): Promise<AlternativeResult[]> {
    const alternatives: AlternativeResult[] = [];

    // Find similar results from the same file or related files
    for (const other of allResults) {
      if (other === result) continue;

      // Same file, different location
      if (
        other.filePath === result.filePath &&
        Math.abs(other.startLine - result.startLine) > 10
      ) {
        alternatives.push({
          chunkId: `${other.snapshotId}:${other.filePath}:${other.startLine}`,
          similarityScore: 0.8,
          description: 'Similar code in the same file',
          differences: ['Different location in file'],
          preferWhen: 'Looking for related functionality in the same module',
        });
      }

      if (alternatives.length >= 3) break; // Limit alternatives
    }

    return alternatives;
  }

  /**
   * Create enhanced metadata
   */
  private async createEnhancedMetadata(
    result: SemanticSearchResult,
    qualityMetrics: any,
  ): Promise<EnhancedResultMetadata> {
    const content = result.content;

    return {
      semanticType: this.detectSemanticType(content),
      designPatterns: this.detectDesignPatterns(content),
      architecturalLayer: this.detectArchitecturalLayer(result.filePath),
      businessDomain: this.detectBusinessDomain(result.filePath),
      frameworkContext: this.detectFrameworks(content),
      dependencies: this.extractDependencies(content),
      usageFrequency: 1, // TODO: Implement usage tracking
      lastModified: result.timestamp,
      complexityMetrics: {
        cyclomaticComplexity: this.calculateCyclomaticComplexity(content),
        cognitiveComplexity: this.calculateCognitiveComplexity(content),
        linesOfCode: content.split('\n').length,
        nestingDepth: this.calculateNestingDepth(content),
        maintainabilityIndex: qualityMetrics.readabilityScore * 100,
      },
      securityConsiderations: this.analyzeSecurityConsiderations(content),
    };
  }

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
  private rankAndFilterResults(
    results: EnhancedSemanticSearchResult[],
    processedQuery: ProcessedQuery,
    options: EnhancedSemanticSearchOptions,
  ): EnhancedSemanticSearchResult[] {
    // Apply filters
    let filteredResults = this.applyFilters(results, processedQuery.filters);

    // Apply ranking strategy
    filteredResults = this.applyRanking(
      filteredResults,
      processedQuery.searchStrategy.ranking,
    );

    // Apply diversification if enabled
    if (processedQuery.searchStrategy.diversification) {
      filteredResults = this.applyDiversification(filteredResults, options);
    }

    // Limit results
    return filteredResults.slice(0, options.limit || 20);
  }

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
        result.qualityMetrics.readabilityScore < filters.qualityThreshold
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
    // Any cleanup needed
    this.processingQueue = [];
    this.isProcessing = false;
    this.performanceMetrics.clear();
    log('Disposed semantic search service');
  }

  /**
   * Calculate quality metrics for a search result
   */
  private async calculateQualityMetricsForResult(result: SemanticSearchResult) {
    try {
      const language = this.detectLanguageFromFilePath(result.filePath);
      const linesOfCode = this.calculateLinesOfCode(result.content);

      return await this.qualityMetricsCalculator.calculateQualityMetrics(
        result.content,
        language,
        linesOfCode,
      );
    } catch (error) {
      log(`Error calculating quality metrics: ${error}`);
      return this.getDefaultQualityMetrics();
    }
  }

  /**
   * Analyze relationships for a search result
   */
  private async analyzeResultRelationships(
    result: SemanticSearchResult,
    allResults: SemanticSearchResult[],
  ) {
    try {
      // Create a simplified chunk representation for relationship analysis
      const enhancedChunk = this.createEnhancedChunkFromResult(result);
      const allChunks = allResults.map((r) =>
        this.createEnhancedChunkFromResult(r),
      );

      const analysisResult =
        await this.relationshipAnalyzer.analyzeChunkRelationships(
          enhancedChunk,
          allChunks,
        );

      return analysisResult.relationships;
    } catch (error) {
      log(`Error analyzing relationships: ${error}`);
      return [];
    }
  }

  /**
   * Generate basic context info for a result
   */
  private async generateBasicContextInfo(result: SemanticSearchResult) {
    const contextInfo = await this.generateContextInfo(result, 5);
    return {
      ...contextInfo,
      fileContext: {
        totalLines: result.content.split('\n').length,
        fileSize: result.content.length,
        lastModified: new Date(result.timestamp),
        encoding: 'utf-8',
        siblingChunks: [],
      },
    };
  }

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
