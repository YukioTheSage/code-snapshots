import * as vscode from 'vscode';
import { log, logVerbose } from '../logger';
import { SnapshotManager, Snapshot } from '../snapshotManager';
import { CredentialsManager } from './credentialsManager';
import { CodeChunker, CodeChunk } from './codeChunker';
import { EmbeddingService } from './embeddingService';
import { VectorDatabaseService, SearchResult } from './vectorDatabaseService';

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

  // Background processing
  private processingQueue: string[] = []; // Queue of snapshot IDs to process
  private isProcessing = false;

  // Cache of which snapshots have been indexed
  private indexedSnapshots: Set<string> = new Set();

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

  /**
   * Dispose resources
   */
  dispose(): void {
    // Any cleanup needed
    this.processingQueue = [];
    this.isProcessing = false;
    log('Disposed semantic search service');
  }
}
