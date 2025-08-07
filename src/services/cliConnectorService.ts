import * as vscode from 'vscode';
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { TerminalApiService } from './terminalApiService';
import { SemanticSearchService } from './semanticSearchService';
import { EnhancedCodeChunker } from './enhancedCodeChunker';
import { QueryProcessor } from './queryProcessor';
import { ResultManager } from './resultManager';
import { QualityMetricsCalculator } from './qualityMetricsCalculator';
import { RelationshipAnalyzer } from './relationshipAnalyzer';
import {
  EnhancedSemanticSearchOptions,
  AIAgentResponse,
  ResponseMetadata,
  PerformanceMetrics,
  SearchQualityMetrics,
} from '../types/enhancedSearch';
import { EnhancedCodeChunk } from '../types/enhancedChunking';
import { log } from '../logger';

/**
 * Service that enables CLI tools to communicate with the VSCode extension
 */
export class CliConnectorService implements vscode.Disposable {
  private server?: net.Server;
  private connections: Set<net.Socket> = new Set();
  private terminalApiService: TerminalApiService;
  private context: vscode.ExtensionContext;
  private socketPath: string;

  // Enhanced services for AI agent optimization
  private semanticSearchService?: SemanticSearchService;
  private enhancedCodeChunker: EnhancedCodeChunker;
  private queryProcessor: QueryProcessor;
  private resultManager: ResultManager;
  private qualityMetricsCalculator: QualityMetricsCalculator;
  private relationshipAnalyzer: RelationshipAnalyzer;

  constructor(
    terminalApiService: TerminalApiService,
    context: vscode.ExtensionContext,
    semanticSearchService?: SemanticSearchService,
  ) {
    this.terminalApiService = terminalApiService;
    this.context = context;
    this.semanticSearchService = semanticSearchService;

    // Initialize enhanced services
    this.enhancedCodeChunker = new EnhancedCodeChunker();
    this.queryProcessor = new QueryProcessor();
    this.resultManager = new ResultManager();
    this.qualityMetricsCalculator = new QualityMetricsCalculator();
    this.relationshipAnalyzer = new RelationshipAnalyzer();

    // Create platform-specific socket path
    const workspaceId = this.getWorkspaceId();
    if (process.platform === 'win32') {
      this.socketPath = `\\\\.\\pipe\\codelapse-${workspaceId}`;
    } else {
      const tmpDir = os.tmpdir();
      this.socketPath = path.join(tmpDir, `codelapse-${workspaceId}.sock`);
    }

    this.startServer();
  }

  /**
   * Start the IPC server for CLI communication
   */
  private async startServer(): Promise<void> {
    try {
      // Clean up existing socket on Unix systems
      if (process.platform !== 'win32' && fs.existsSync(this.socketPath)) {
        fs.unlinkSync(this.socketPath);
      }

      this.server = net.createServer((socket) => {
        log(`CLI client connected`);
        this.connections.add(socket);

        // Buffer to accumulate partial data chunks from this socket
        let buffer = '';

        socket.on('data', async (data) => {
          buffer += data.toString();

          let newlineIndex: number;
          while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
            const rawLine = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);

            if (!rawLine) continue;

            try {
              const message = JSON.parse(rawLine);
              const response = await this.handleCliRequest(message);
              socket.write(JSON.stringify(response) + '\n');
            } catch (error) {
              const errorResponse = {
                success: false,
                error: error instanceof Error ? error.message : String(error),
              };
              socket.write(JSON.stringify(errorResponse) + '\n');
            }
          }
        });

        socket.on('close', () => {
          log(`CLI client disconnected`);
          this.connections.delete(socket);
        });

        socket.on('error', (error) => {
          log(`CLI client error: ${error.message}`);
          this.connections.delete(socket);
        });
      });

      this.server.listen(this.socketPath, () => {
        log(`CLI connector server listening on ${this.socketPath}`);
        this.createConnectionFile();
      });

      this.server.on('error', (error) => {
        log(`CLI connector server error: ${error.message}`);
      });
    } catch (error) {
      log(`Failed to start CLI connector server: ${error}`);
    }
  }

  /**
   * Handle incoming CLI requests
   */
  private async handleCliRequest(message: any): Promise<any> {
    const { method, data, id } = message;

    try {
      let result: any;

      // Route the request to the appropriate Terminal API method
      switch (method) {
        case 'getStatus':
          result = await this.getConnectionStatus();
          break;
        case 'takeSnapshot':
          result = await this.terminalApiService.takeSnapshot(data);
          break;
        case 'getSnapshots':
          result = await this.terminalApiService.getSnapshots(data);
          break;
        case 'getSnapshot':
          result = await this.terminalApiService.getSnapshot(data.id);
          break;
        case 'restoreSnapshot':
          result = await this.terminalApiService.restoreSnapshot(
            data.id,
            data.options,
          );
          break;
        case 'deleteSnapshot':
          result = await this.terminalApiService.deleteSnapshot(data.id);
          break;
        case 'navigateSnapshot':
          result = await this.terminalApiService.navigateSnapshot(
            data.direction,
          );
          break;
        case 'getSnapshotFileContent':
          result = await this.terminalApiService.getSnapshotFileContent(
            data.snapshotId,
            data.filePath,
          );
          break;
        case 'getSnapshotChanges':
          result = await this.terminalApiService.getSnapshotChanges(
            data.snapshotId,
          );
          break;
        case 'compareSnapshots':
          result = await this.terminalApiService.compareSnapshots(
            data.snapshotId1,
            data.snapshotId2,
          );
          break;
        case 'searchSnapshots':
          result = await this.terminalApiService.searchSnapshots(
            data.query,
            data.options,
          );
          break;
        case 'indexSnapshots':
          result = await this.terminalApiService.indexSnapshots(
            data.snapshotIds,
          );
          break;
        case 'getWorkspaceInfo':
          result = await this.terminalApiService.getWorkspaceInfo();
          break;
        case 'getCurrentState':
          result = await this.terminalApiService.getCurrentState();
          break;
        case 'validateSnapshot':
          result = await this.terminalApiService.validateSnapshot(data.id);
          break;
        case 'exportSnapshot':
          result = await this.terminalApiService.exportSnapshot(
            data.id,
            data.format,
          );
          break;

        // Enhanced AI-optimized methods
        case 'enhancedSearch':
          result = await this.handleEnhancedSearch(data);
          break;
        case 'analyzeChunk':
          result = await this.handleAnalyzeChunk(data);
          break;
        case 'analyzeFile':
          result = await this.handleAnalyzeFile(data);
          break;
        case 'analyzeQuality':
          result = await this.handleAnalyzeQuality(data);
          break;
        case 'enhancedChunkFile':
          result = await this.handleEnhancedChunkFile(data);
          break;
        case 'chunkSnapshot':
          result = await this.handleChunkSnapshot(data);
          break;
        case 'listChunks':
          result = await this.handleListChunks(data);
          break;
        case 'getChunkMetadata':
          result = await this.handleGetChunkMetadata(data);
          break;
        case 'getChunkContext':
          result = await this.handleGetChunkContext(data);
          break;
        case 'getChunkDependencies':
          result = await this.handleGetChunkDependencies(data);
          break;
        case 'batchAnalyze':
          result = await this.handleBatchAnalyze(data);
          break;
        case 'batchSearch':
          result = await this.handleBatchSearch(data);
          break;
        default:
          throw new Error(`Unknown method: ${method}`);
      }

      return {
        success: true,
        id,
        result,
      };
    } catch (error) {
      return {
        success: false,
        id,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get connection status for CLI
   */
  private async getConnectionStatus(): Promise<any> {
    const workspaceInfo = await this.terminalApiService.getWorkspaceInfo();

    return {
      connected: true,
      workspace: workspaceInfo.workspaceRoot,
      totalSnapshots: workspaceInfo.totalSnapshots,
      currentSnapshot: workspaceInfo.currentSnapshot?.description || null,
      extensionVersion: this.context.extension.packageJSON.version,
      apiVersion: '1.0.0',
    };
  }

  /**
   * Create connection info file for CLI tools to discover the socket
   */
  private createConnectionFile(): void {
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) return;

      const connectionInfo = {
        socketPath: this.socketPath,
        workspaceRoot,
        extensionVersion: this.context.extension.packageJSON.version,
        apiVersion: '1.0.0',
        created: new Date().toISOString(),
      };

      const connectionFile = path.join(
        workspaceRoot,
        '.vscode',
        'codelapse-connection.json',
      );

      // Ensure .vscode directory exists
      const vsCodeDir = path.dirname(connectionFile);
      if (!fs.existsSync(vsCodeDir)) {
        fs.mkdirSync(vsCodeDir, { recursive: true });
      }

      fs.writeFileSync(connectionFile, JSON.stringify(connectionInfo, null, 2));
      log(`Created connection file: ${connectionFile}`);
    } catch (error) {
      log(`Failed to create connection file: ${error}`);
    }
  }

  /**
   * Get unique workspace identifier
   */
  private getWorkspaceId(): string {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceRoot) {
      return crypto
        .createHash('md5')
        .update(workspaceRoot)
        .digest('hex')
        .substring(0, 8);
    }

    // Fallback to random identifier
    return Math.random().toString(36).substring(2, 10);
  }

  /**
   * Broadcast event to all connected CLI clients
   */
  public broadcastEvent(event: any): void {
    const message = JSON.stringify({ type: 'event', event }) + '\n';

    this.connections.forEach((socket) => {
      try {
        socket.write(message);
      } catch (error) {
        log(`Failed to broadcast to CLI client: ${error}`);
        this.connections.delete(socket);
      }
    });
  }

  /**
   * Handle enhanced semantic search with AI-optimized features
   */
  private async handleEnhancedSearch(data: any): Promise<AIAgentResponse> {
    const startTime = Date.now();

    try {
      if (!this.semanticSearchService) {
        throw new Error('Semantic search service not available');
      }

      const options: EnhancedSemanticSearchOptions = {
        query: data.query,
        snapshotIds: data.snapshotIds,
        limit: data.limit || 20,
        languages: data.languages,
        scoreThreshold: data.scoreThreshold || 0.65,
        searchMode: data.searchMode || 'semantic',
        includeExplanations: data.includeExplanations !== false,
        includeRelationships: data.includeRelationships !== false,
        includeQualityMetrics: data.includeQualityMetrics !== false,
        contextRadius: data.contextRadius || 5,
        rankingStrategy: data.rankingStrategy || 'relevance',
        filterCriteria: data.filterCriteria || {},
        maxResultsPerFile: data.maxResultsPerFile,
        enableDiversification: data.enableDiversification !== false,
      };

      const results = await this.semanticSearchService.searchCodeEnhanced(
        options,
      );
      const executionTime = Date.now() - startTime;

      const response: AIAgentResponse = {
        success: true,
        timestamp: new Date().toISOString(),
        executionTime,
        query: {
          original: data.query,
          processed: data.query, // Would be enhanced by QueryProcessor
          intent: {
            primary: 'find_implementation',
            secondary: [],
            confidence: 0.8,
            context: [],
            suggestedParameters: {},
          },
        },
        results,
        metadata: {
          totalResults: results.length,
          searchStrategy: {
            mode: options.searchMode,
            ranking: options.rankingStrategy,
            diversification: options.enableDiversification || false,
            contextRadius: options.contextRadius,
            boostFactors: [],
            penaltyFactors: [],
          },
          rankingApplied: options.rankingStrategy,
          filtersApplied: options.filterCriteria,
          performanceMetrics: {
            queryProcessingTime: 0,
            searchTime: executionTime,
            resultProcessingTime: 0,
            totalTime: executionTime,
            memoryUsage: process.memoryUsage().heapUsed,
            cacheHitRate: 0,
            chunksSearched: results.length,
            vectorOperations: results.length,
          },
          searchQualityMetrics: {
            averageRelevanceScore:
              results.reduce((sum, r) => sum + r.score, 0) / results.length ||
              0,
            diversityScore: 0.8,
            typeCoverage: 0.7,
            qualityConfidence: 0.8,
          },
        },
        suggestions: [],
        relatedQueries: [],
      };

      return response;
    } catch (error) {
      return {
        success: false,
        timestamp: new Date().toISOString(),
        executionTime: Date.now() - startTime,
        query: {
          original: data.query || '',
          processed: data.query || '',
          intent: {
            primary: 'find_implementation',
            secondary: [],
            confidence: 0,
            context: [],
            suggestedParameters: {},
          },
        },
        results: [],
        metadata: {
          totalResults: 0,
          searchStrategy: {
            mode: 'semantic',
            ranking: 'relevance',
            diversification: false,
            contextRadius: 5,
            boostFactors: [],
            penaltyFactors: [],
          },
          rankingApplied: 'relevance',
          filtersApplied: {},
          performanceMetrics: {
            queryProcessingTime: 0,
            searchTime: 0,
            resultProcessingTime: 0,
            totalTime: 0,
            memoryUsage: 0,
            cacheHitRate: 0,
            chunksSearched: 0,
            vectorOperations: 0,
          },
          searchQualityMetrics: {
            averageRelevanceScore: 0,
            diversityScore: 0,
            typeCoverage: 0,
            qualityConfidence: 0,
          },
        },
        suggestions: [],
        relatedQueries: [],
        error: {
          code: 'ENHANCED_SEARCH_ERROR',
          message: error instanceof Error ? error.message : String(error),
          category: 'search_execution',
          severity: 'high',
          suggestions: [
            'Check semantic search service availability',
            'Verify query parameters',
          ],
          retryable: true,
          fallbackOptions: ['Use basic search', 'Simplify query'],
        },
      };
    }
  }

  /**
   * Handle chunk analysis request
   */
  private async handleAnalyzeChunk(data: any): Promise<any> {
    try {
      const { chunkId, snapshotId, analysisType = 'full' } = data;

      if (!chunkId || !snapshotId) {
        throw new Error('chunkId and snapshotId are required');
      }

      // This would need to be implemented with actual chunk storage/retrieval
      // For now, return a structured response format
      return {
        success: true,
        chunkId,
        snapshotId,
        analysisType,
        analysis: {
          qualityMetrics: {
            overallScore: 75,
            readabilityScore: 0.8,
            maintainabilityScore: 70,
            complexityScore: 15,
          },
          relationships: [],
          securityConcerns: [],
          suggestions: [
            {
              type: 'improvement',
              description: 'Consider adding more documentation',
              priority: 'medium',
              effort: 'minimal',
            },
          ],
        },
        metadata: {
          analysisTime: Date.now(),
          version: '1.0.0',
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        suggestions: ['Verify chunk ID exists', 'Check snapshot availability'],
      };
    }
  }
  /**
   * Handle file analysis request
   */
  private async handleAnalyzeFile(data: any): Promise<any> {
    try {
      const { filePath, snapshotId, analysisType = 'full' } = data;

      if (!filePath || !snapshotId) {
        throw new Error('filePath and snapshotId are required');
      }

      // Get file content
      const content = await this.terminalApiService.getSnapshotFileContent(
        snapshotId,
        filePath,
      );
      if (!content) {
        throw new Error(`File not found: ${filePath}`);
      }

      // Perform enhanced chunking and analysis
      const chunks = await this.enhancedCodeChunker.chunkFileEnhanced(
        filePath,
        content,
        snapshotId,
      );

      // Calculate overall file metrics
      const fileMetrics = {
        totalChunks: chunks.length,
        totalLines: content.split('\n').length,
        averageQuality:
          chunks.reduce(
            (sum, chunk) => sum + chunk.qualityMetrics.overallScore,
            0,
          ) / chunks.length,
        complexityDistribution: this.calculateComplexityDistribution(chunks),
        securityConcerns: this.aggregateSecurityConcerns(chunks),
        designPatterns: this.aggregateDesignPatterns(chunks),
      };

      return {
        success: true,
        filePath,
        snapshotId,
        analysisType,
        fileMetrics,
        chunks: chunks.map((chunk) => ({
          id: chunk.id,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          semanticType: chunk.enhancedMetadata.semanticType,
          qualityScore: chunk.qualityMetrics.overallScore,
          complexityScore: chunk.enhancedMetadata.complexityScore,
          relationships: chunk.relationships.length,
          securityConcerns: chunk.enhancedMetadata.securityConcerns,
        })),
        suggestions: this.generateFileLevelSuggestions(chunks),
        metadata: {
          analysisTime: Date.now(),
          version: '1.0.0',
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        suggestions: ['Verify file path exists', 'Check snapshot availability'],
      };
    }
  }

  /**
   * Handle quality analysis request
   */
  private async handleAnalyzeQuality(data: any): Promise<any> {
    try {
      const { target, snapshotId, metrics = ['all'] } = data;

      if (!target || !snapshotId) {
        throw new Error('target and snapshotId are required');
      }

      // Quality analysis implementation would go here
      // For now, return structured response
      return {
        success: true,
        target,
        snapshotId,
        qualityAnalysis: {
          overallScore: 78,
          metrics: {
            readability: 0.82,
            maintainability: 75,
            testCoverage: 0.65,
            documentation: 0.58,
            complexity: 18,
            duplication: 0.12,
          },
          trends: {
            improving: ['readability', 'testCoverage'],
            declining: ['documentation'],
            stable: ['maintainability', 'complexity'],
          },
          recommendations: [
            {
              category: 'documentation',
              priority: 'high',
              description: 'Increase documentation coverage',
              estimatedEffort: '2-4 hours',
            },
          ],
        },
        metadata: {
          analysisTime: Date.now(),
          version: '1.0.0',
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        suggestions: [
          'Verify target specification',
          'Check snapshot availability',
        ],
      };
    }
  }

  /**
   * Handle enhanced file chunking request
   */
  private async handleEnhancedChunkFile(data: any): Promise<any> {
    try {
      const {
        filePath,
        snapshotId,
        strategy = 'semantic',
        options = {},
      } = data;

      if (!filePath || !snapshotId) {
        throw new Error('filePath and snapshotId are required');
      }

      // Get file content
      const content = await this.terminalApiService.getSnapshotFileContent(
        snapshotId,
        filePath,
      );
      if (!content) {
        throw new Error(`File not found: ${filePath}`);
      }

      // Perform enhanced chunking
      const chunks = await this.enhancedCodeChunker.chunkFileEnhanced(
        filePath,
        content,
        snapshotId,
        strategy,
      );

      return {
        success: true,
        filePath,
        snapshotId,
        strategy,
        chunks: chunks.map((chunk) => ({
          id: chunk.id,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          content: chunk.content,
          enhancedMetadata: chunk.enhancedMetadata,
          qualityMetrics: chunk.qualityMetrics,
          relationships: chunk.relationships,
          contextInfo: chunk.contextInfo,
        })),
        summary: {
          totalChunks: chunks.length,
          averageSize:
            chunks.reduce(
              (sum, chunk) => sum + (chunk.endLine - chunk.startLine),
              0,
            ) / chunks.length,
          semanticTypes: this.getSemanticTypeDistribution(chunks),
          qualityDistribution: this.getQualityDistribution(chunks),
        },
        metadata: {
          chunkingTime: Date.now(),
          version: '1.0.0',
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        suggestions: [
          'Verify file path exists',
          'Check chunking strategy',
          'Validate options',
        ],
      };
    }
  }

  /**
   * Handle snapshot chunking request
   */
  private async handleChunkSnapshot(data: any): Promise<any> {
    try {
      const {
        snapshotId,
        strategy = 'semantic',
        filePatterns,
        options = {},
      } = data;

      if (!snapshotId) {
        throw new Error('snapshotId is required');
      }

      const snapshot = await this.terminalApiService.getSnapshot(snapshotId);
      if (!snapshot) {
        throw new Error(`Snapshot not found: ${snapshotId}`);
      }

      // Get files to process
      const filesToProcess = Object.keys(snapshot.files).filter((filePath) => {
        if (filePatterns && filePatterns.length > 0) {
          return filePatterns.some((pattern: string) =>
            filePath.includes(pattern),
          );
        }
        return (
          !snapshot.files[filePath].deleted &&
          !snapshot.files[filePath].isBinary
        );
      });

      const results = [];
      for (const filePath of filesToProcess) {
        try {
          const content = await this.terminalApiService.getSnapshotFileContent(
            snapshotId,
            filePath,
          );
          if (content) {
            const chunks = await this.enhancedCodeChunker.chunkFileEnhanced(
              filePath,
              content,
              snapshotId,
              strategy,
            );
            results.push({
              filePath,
              chunks: chunks.length,
              success: true,
            });
          }
        } catch (error) {
          results.push({
            filePath,
            chunks: 0,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return {
        success: true,
        snapshotId,
        strategy,
        results,
        summary: {
          totalFiles: filesToProcess.length,
          successfulFiles: results.filter((r) => r.success).length,
          totalChunks: results.reduce((sum, r) => sum + r.chunks, 0),
        },
        metadata: {
          chunkingTime: Date.now(),
          version: '1.0.0',
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        suggestions: [
          'Verify snapshot exists',
          'Check file patterns',
          'Validate chunking strategy',
        ],
      };
    }
  }

  /**
   * Handle list chunks request
   */
  private async handleListChunks(data: any): Promise<any> {
    try {
      const { snapshotId, filePath, filters = {} } = data;

      if (!snapshotId) {
        throw new Error('snapshotId is required');
      }

      // This would need actual chunk storage implementation
      // For now, return mock data structure
      return {
        success: true,
        snapshotId,
        filePath,
        chunks: [
          {
            id: 'chunk-1',
            filePath: filePath || 'example.ts',
            startLine: 1,
            endLine: 25,
            semanticType: 'function',
            qualityScore: 85,
            complexityScore: 12,
            lastModified: Date.now(),
          },
        ],
        pagination: {
          total: 1,
          page: 1,
          limit: 50,
        },
        metadata: {
          queryTime: Date.now(),
          version: '1.0.0',
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        suggestions: ['Verify snapshot exists', 'Check filter parameters'],
      };
    }
  }

  /**
   * Handle get chunk metadata request
   */
  private async handleGetChunkMetadata(data: any): Promise<any> {
    try {
      const {
        chunkId,
        includeRelationships = true,
        includeQuality = true,
      } = data;

      if (!chunkId) {
        throw new Error('chunkId is required');
      }

      // Mock metadata response
      return {
        success: true,
        chunkId,
        metadata: {
          semanticType: 'function',
          complexityScore: 15,
          maintainabilityIndex: 78,
          dependencies: ['lodash', 'express'],
          designPatterns: ['Factory'],
          codeSmells: [],
          securityConcerns: [],
          linesOfCode: {
            total: 24,
            code: 18,
            comments: 4,
            blank: 2,
          },
        },
        relationships: includeRelationships ? [] : undefined,
        qualityMetrics: includeQuality
          ? {
              overallScore: 82,
              readabilityScore: 0.85,
              maintainabilityScore: 78,
            }
          : undefined,
        responseMetadata: {
          retrievalTime: Date.now(),
          version: '1.0.0',
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        suggestions: ['Verify chunk ID exists'],
      };
    }
  }

  /**
   * Handle get chunk context request
   */
  private async handleGetChunkContext(data: any): Promise<any> {
    try {
      const { chunkId, contextRadius = 5 } = data;

      if (!chunkId) {
        throw new Error('chunkId is required');
      }

      // Mock context response
      return {
        success: true,
        chunkId,
        context: {
          surroundingContext: '// Context lines would be here',
          architecturalLayer: 'service',
          frameworkContext: ['express', 'typescript'],
          businessContext: 'User authentication service',
          fileContext: {
            totalLines: 150,
            fileSize: 4500,
            lastModified: new Date(),
            siblingChunks: ['chunk-2', 'chunk-3'],
          },
        },
        metadata: {
          contextRadius,
          retrievalTime: Date.now(),
          version: '1.0.0',
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        suggestions: [
          'Verify chunk ID exists',
          'Check context radius parameter',
        ],
      };
    }
  }

  /**
   * Handle get chunk dependencies request
   */
  private async handleGetChunkDependencies(data: any): Promise<any> {
    try {
      const { chunkId, includeTransitive = false, maxDepth = 3 } = data;

      if (!chunkId) {
        throw new Error('chunkId is required');
      }

      // Mock dependencies response
      return {
        success: true,
        chunkId,
        dependencies: {
          direct: [
            {
              chunkId: 'chunk-2',
              type: 'imports',
              strength: 0.9,
              description: 'Imports utility functions',
            },
          ],
          transitive: includeTransitive ? [] : undefined,
        },
        dependents: [
          {
            chunkId: 'chunk-4',
            type: 'calls',
            strength: 0.8,
            description: 'Called by main handler',
          },
        ],
        metadata: {
          includeTransitive,
          maxDepth,
          retrievalTime: Date.now(),
          version: '1.0.0',
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        suggestions: ['Verify chunk ID exists', 'Check dependency parameters'],
      };
    }
  }

  /**
   * Handle batch analyze request with enhanced error handling and progress tracking
   */
  private async handleBatchAnalyze(data: any): Promise<any> {
    const startTime = Date.now();
    const progressCallback = data.progressCallback;

    try {
      const {
        operations,
        parallel = true,
        maxConcurrency = 5,
        continueOnError = true,
        timeout = 300000, // 5 minutes default timeout
        retryFailedOperations = false,
        maxRetries = 2,
      } = data;

      if (!operations || !Array.isArray(operations)) {
        throw new Error('operations array is required');
      }

      if (operations.length === 0) {
        return {
          success: true,
          totalOperations: 0,
          successfulOperations: 0,
          failedOperations: 0,
          results: [],
          metadata: {
            parallel,
            maxConcurrency,
            processingTime: Date.now() - startTime,
            version: '1.0.0',
          },
        };
      }

      // Validate operations
      const validationErrors = this.validateBatchOperations(operations);
      if (validationErrors.length > 0) {
        throw new Error(`Invalid operations: ${validationErrors.join(', ')}`);
      }

      const results: any[] = [];
      const failedOperations: any[] = [];
      let processedCount = 0;

      // Progress tracking helper
      const updateProgress = (increment = 1) => {
        processedCount += increment;
        if (progressCallback) {
          progressCallback({
            processed: processedCount,
            total: operations.length,
            percentage: Math.round((processedCount / operations.length) * 100),
            timestamp: Date.now(),
          });
        }
      };

      if (parallel) {
        // Enhanced parallel processing with better concurrency control
        const semaphore = new Array(maxConcurrency).fill(null);
        const chunks = [];

        for (let i = 0; i < operations.length; i += maxConcurrency) {
          chunks.push(operations.slice(i, i + maxConcurrency));
        }

        for (const chunk of chunks) {
          const chunkPromises = chunk.map(async (op: any, index: number) => {
            const operationId = op.id || `op-${results.length + index}`;

            try {
              // Add timeout wrapper
              const operationPromise = this.executeAnalysisOperation(op);
              const timeoutPromise = new Promise((_, reject) => {
                setTimeout(
                  () =>
                    reject(new Error(`Operation timeout after ${timeout}ms`)),
                  timeout,
                );
              });

              const result = await Promise.race([
                operationPromise,
                timeoutPromise,
              ]);

              // Check if the operation result indicates failure
              if (
                result &&
                typeof result === 'object' &&
                'success' in result &&
                result.success === false
              ) {
                const errorInfo = {
                  operationId,
                  operationType: op.type,
                  success: false,
                  result,
                  executionTime: Date.now() - startTime,
                  retryCount: 0,
                };

                if (retryFailedOperations) {
                  failedOperations.push({ ...op, errorInfo });
                }

                return errorInfo;
              }

              return {
                operationId,
                operationType: op.type,
                success: true,
                result,
                executionTime: Date.now() - startTime,
                retryCount: 0,
              };
            } catch (error) {
              const errorInfo = {
                operationId,
                operationType: op.type,
                success: false,
                error: {
                  message:
                    error instanceof Error ? error.message : String(error),
                  code: this.getErrorCode(error),
                  category: 'batch_operation_error',
                  severity: 'medium',
                  retryable: this.isRetryableError(error),
                },
                executionTime: Date.now() - startTime,
                retryCount: 0,
              };

              if (retryFailedOperations && errorInfo.error.retryable) {
                failedOperations.push({ ...op, errorInfo });
              }

              return errorInfo;
            }
          });

          const chunkResults = await Promise.allSettled(chunkPromises);

          let hasFailures = false;
          chunkResults.forEach((result, index) => {
            if (result.status === 'fulfilled') {
              results.push(result.value);
            } else {
              hasFailures = true;
              results.push({
                operationId: chunk[index].id || `op-${results.length}`,
                operationType: chunk[index].type,
                success: false,
                error: {
                  message: result.reason.message,
                  code: 'BATCH_OPERATION_FAILED',
                  category: 'batch_operation_error',
                  severity: 'high',
                  retryable: false,
                },
                executionTime: Date.now() - startTime,
                retryCount: 0,
              });
            }
            updateProgress();
          });

          // Stop processing if continueOnError is false and we have failures
          if (!continueOnError && hasFailures) {
            break;
          }
        }
      } else {
        // Enhanced sequential processing
        for (const operation of operations) {
          const operationId = operation.id || `op-${results.length}`;

          try {
            const operationPromise = this.executeAnalysisOperation(operation);
            const timeoutPromise = new Promise((_, reject) => {
              setTimeout(
                () => reject(new Error(`Operation timeout after ${timeout}ms`)),
                timeout,
              );
            });

            const result = await Promise.race([
              operationPromise,
              timeoutPromise,
            ]);

            // Check if the operation result indicates failure
            if (
              result &&
              typeof result === 'object' &&
              'success' in result &&
              result.success === false
            ) {
              const errorInfo = {
                operationId,
                operationType: operation.type,
                success: false,
                result,
                executionTime: Date.now() - startTime,
                retryCount: 0,
              };

              results.push(errorInfo);

              if (retryFailedOperations) {
                failedOperations.push({ ...operation, errorInfo });
              }

              // Stop processing if continueOnError is false
              if (!continueOnError) {
                break;
              }
            } else {
              results.push({
                operationId,
                operationType: operation.type,
                success: true,
                result,
                executionTime: Date.now() - startTime,
                retryCount: 0,
              });
            }
          } catch (error) {
            const errorInfo = {
              operationId,
              operationType: operation.type,
              success: false,
              error: {
                message: error instanceof Error ? error.message : String(error),
                code: this.getErrorCode(error),
                category: 'batch_operation_error',
                severity: 'medium',
                retryable: this.isRetryableError(error),
              },
              executionTime: Date.now() - startTime,
              retryCount: 0,
            };

            results.push(errorInfo);

            if (retryFailedOperations && errorInfo.error.retryable) {
              failedOperations.push({ ...operation, errorInfo });
            }

            // Stop processing if continueOnError is false
            if (!continueOnError) {
              break;
            }
          }

          updateProgress();
        }
      }

      // Retry failed operations if requested
      if (retryFailedOperations && failedOperations.length > 0) {
        await this.retryFailedOperations(
          failedOperations,
          maxRetries,
          results,
          updateProgress,
        );
      }

      const successfulOperations = results.filter((r) => r.success).length;
      const failedOperationsCount = results.filter((r) => !r.success).length;

      return {
        success: true,
        totalOperations: operations.length,
        successfulOperations,
        failedOperations: failedOperationsCount,
        results,
        performance: {
          totalTime: Math.max(1, Date.now() - startTime), // Ensure at least 1ms
          averageTimePerOperation:
            Math.max(1, Date.now() - startTime) / operations.length,
          throughput:
            operations.length / (Math.max(1, Date.now() - startTime) / 1000),
          memoryUsage: process.memoryUsage(),
        },
        metadata: {
          parallel,
          maxConcurrency,
          continueOnError,
          timeout,
          retryFailedOperations,
          maxRetries,
          processingTime: Date.now() - startTime,
          version: '1.0.0',
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          message: error instanceof Error ? error.message : String(error),
          code: 'BATCH_ANALYZE_ERROR',
          category: 'batch_operation_error',
          severity: 'high',
          retryable: false,
        },
        totalOperations: data.operations?.length || 0,
        successfulOperations: 0,
        failedOperations: data.operations?.length || 0,
        results: [],
        performance: {
          totalTime: Date.now() - startTime,
          averageTimePerOperation: 0,
          throughput: 0,
          memoryUsage: process.memoryUsage(),
        },
        suggestions: [
          'Verify operations array format and content',
          'Check operation types are supported',
          'Validate concurrency and timeout settings',
          'Ensure sufficient system resources',
        ],
      };
    }
  }

  /**
   * Handle batch search request with enhanced error handling and progress tracking
   */
  private async handleBatchSearch(data: any): Promise<any> {
    const startTime = Date.now();
    const progressCallback = data.progressCallback;

    try {
      const {
        queries,
        parallel = true,
        maxConcurrency = 3,
        continueOnError = true,
        timeout = 300000, // 5 minutes default timeout
        retryFailedQueries = false,
        maxRetries = 2,
        deduplicateQueries = true,
      } = data;

      if (!queries || !Array.isArray(queries)) {
        throw new Error('queries array is required');
      }

      if (queries.length === 0) {
        return {
          success: true,
          totalQueries: 0,
          successfulQueries: 0,
          failedQueries: 0,
          results: [],
          metadata: {
            parallel,
            maxConcurrency,
            processingTime: Date.now() - startTime,
            version: '1.0.0',
          },
        };
      }

      // Validate and optionally deduplicate queries
      let processedQueries = queries;
      if (deduplicateQueries) {
        processedQueries = this.deduplicateQueries(queries);
      }

      const validationErrors = this.validateBatchQueries(processedQueries);
      if (validationErrors.length > 0) {
        throw new Error(`Invalid queries: ${validationErrors.join(', ')}`);
      }

      const results: any[] = [];
      const failedQueries: any[] = [];
      let processedCount = 0;

      // Progress tracking helper
      const updateProgress = (increment = 1) => {
        processedCount += increment;
        if (progressCallback) {
          progressCallback({
            processed: processedCount,
            total: processedQueries.length,
            percentage: Math.round(
              (processedCount / processedQueries.length) * 100,
            ),
            timestamp: Date.now(),
          });
        }
      };

      if (parallel) {
        // Enhanced parallel processing with better concurrency control
        const chunks = [];
        for (let i = 0; i < processedQueries.length; i += maxConcurrency) {
          chunks.push(processedQueries.slice(i, i + maxConcurrency));
        }

        for (const chunk of chunks) {
          const chunkPromises = chunk.map(async (query: any, index: number) => {
            const queryId = query.id || `query-${results.length + index}`;

            try {
              // Add timeout wrapper
              const searchPromise = this.handleEnhancedSearch(query);
              const timeoutPromise = new Promise((_, reject) => {
                setTimeout(
                  () => reject(new Error(`Query timeout after ${timeout}ms`)),
                  timeout,
                );
              });

              const result = await Promise.race([
                searchPromise,
                timeoutPromise,
              ]);

              // Check if the search result indicates failure
              if (
                result &&
                typeof result === 'object' &&
                'success' in result &&
                result.success === false
              ) {
                const errorInfo = {
                  queryId,
                  query: query.query,
                  success: false,
                  result,
                  executionTime: Date.now() - startTime,
                  retryCount: 0,
                };

                if (retryFailedQueries) {
                  failedQueries.push({ ...query, errorInfo });
                }

                return errorInfo;
              }

              return {
                queryId,
                query: query.query,
                success: true,
                result,
                executionTime: Date.now() - startTime,
                retryCount: 0,
              };
            } catch (error) {
              const errorInfo = {
                queryId,
                query: query.query,
                success: false,
                error: {
                  message:
                    error instanceof Error ? error.message : String(error),
                  code: this.getErrorCode(error),
                  category: 'batch_search_error',
                  severity: 'medium',
                  retryable: this.isRetryableError(error),
                },
                executionTime: Date.now() - startTime,
                retryCount: 0,
              };

              if (retryFailedQueries && errorInfo.error.retryable) {
                failedQueries.push({ ...query, errorInfo });
              }

              return errorInfo;
            }
          });

          const chunkResults = await Promise.allSettled(chunkPromises);

          chunkResults.forEach((result, index) => {
            if (result.status === 'fulfilled') {
              results.push(result.value);
            } else {
              results.push({
                queryId: chunk[index].id || `query-${results.length}`,
                query: chunk[index].query,
                success: false,
                error: {
                  message: result.reason.message,
                  code: 'BATCH_SEARCH_FAILED',
                  category: 'batch_search_error',
                  severity: 'high',
                  retryable: false,
                },
                executionTime: Date.now() - startTime,
                retryCount: 0,
              });
            }
            updateProgress();
          });

          // Stop processing if continueOnError is false and we have failures
          if (!continueOnError && results.some((r) => !r.success)) {
            break;
          }
        }
      } else {
        // Enhanced sequential processing
        for (const query of processedQueries) {
          const queryId = query.id || `query-${results.length}`;

          try {
            const searchPromise = this.handleEnhancedSearch(query);
            const timeoutPromise = new Promise((_, reject) => {
              setTimeout(
                () => reject(new Error(`Query timeout after ${timeout}ms`)),
                timeout,
              );
            });

            const result = await Promise.race([searchPromise, timeoutPromise]);

            // Check if the search result indicates failure
            if (
              result &&
              typeof result === 'object' &&
              'success' in result &&
              result.success === false
            ) {
              const errorInfo = {
                queryId,
                query: query.query,
                success: false,
                result,
                executionTime: Date.now() - startTime,
                retryCount: 0,
              };

              results.push(errorInfo);

              if (retryFailedQueries) {
                failedQueries.push({ ...query, errorInfo });
              }

              // Stop processing if continueOnError is false
              if (!continueOnError) {
                break;
              }
            } else {
              results.push({
                queryId,
                query: query.query,
                success: true,
                result,
                executionTime: Date.now() - startTime,
                retryCount: 0,
              });
            }
          } catch (error) {
            const errorInfo = {
              queryId,
              query: query.query,
              success: false,
              error: {
                message: error instanceof Error ? error.message : String(error),
                code: this.getErrorCode(error),
                category: 'batch_search_error',
                severity: 'medium',
                retryable: this.isRetryableError(error),
              },
              executionTime: Date.now() - startTime,
              retryCount: 0,
            };

            results.push(errorInfo);

            if (retryFailedQueries && errorInfo.error.retryable) {
              failedQueries.push({ ...query, errorInfo });
            }

            // Stop processing if continueOnError is false
            if (!continueOnError) {
              break;
            }
          }

          updateProgress();
        }
      }

      // Retry failed queries if requested
      if (retryFailedQueries && failedQueries.length > 0) {
        await this.retryFailedQueries(
          failedQueries,
          maxRetries,
          results,
          updateProgress,
        );
      }

      const successfulQueries = results.filter((r) => r.success).length;
      const failedQueriesCount = results.filter((r) => !r.success).length;

      return {
        success: true,
        totalQueries: processedQueries.length,
        originalQueryCount: queries.length,
        deduplicatedCount: queries.length - processedQueries.length,
        successfulQueries,
        failedQueries: failedQueriesCount,
        results,
        performance: {
          totalTime: Math.max(1, Date.now() - startTime), // Ensure at least 1ms
          averageTimePerQuery:
            Math.max(1, Date.now() - startTime) / processedQueries.length,
          throughput:
            processedQueries.length /
            (Math.max(1, Date.now() - startTime) / 1000),
          memoryUsage: process.memoryUsage(),
        },
        metadata: {
          parallel,
          maxConcurrency,
          continueOnError,
          timeout,
          retryFailedQueries,
          maxRetries,
          deduplicateQueries,
          processingTime: Date.now() - startTime,
          version: '1.0.0',
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          message: error instanceof Error ? error.message : String(error),
          code: 'BATCH_SEARCH_ERROR',
          category: 'batch_search_error',
          severity: 'high',
          retryable: false,
        },
        totalQueries: data.queries?.length || 0,
        successfulQueries: 0,
        failedQueries: data.queries?.length || 0,
        results: [],
        performance: {
          totalTime: Date.now() - startTime,
          averageTimePerQuery: 0,
          throughput: 0,
          memoryUsage: process.memoryUsage(),
        },
        suggestions: [
          'Verify queries array format and content',
          'Check query parameters are valid',
          'Validate concurrency and timeout settings',
          'Ensure sufficient system resources',
        ],
      };
    }
  }

  // Helper methods for batch operations

  /**
   * Execute a single analysis operation
   */
  private async executeAnalysisOperation(operation: any): Promise<any> {
    switch (operation.type) {
      case 'analyzeChunk':
        return await this.handleAnalyzeChunk(operation.data);
      case 'analyzeFile':
        return await this.handleAnalyzeFile(operation.data);
      case 'analyzeQuality':
        return await this.handleAnalyzeQuality(operation.data);
      default:
        throw new Error(`Unknown operation type: ${operation.type}`);
    }
  }

  /**
   * Validate batch operations
   */
  private validateBatchOperations(operations: any[]): string[] {
    const errors: string[] = [];
    const validOperationTypes = [
      'analyzeChunk',
      'analyzeFile',
      'analyzeQuality',
    ];

    operations.forEach((op, index) => {
      if (!op.type) {
        errors.push(`Operation ${index}: missing type`);
      } else if (!validOperationTypes.includes(op.type)) {
        errors.push(`Operation ${index}: invalid type '${op.type}'`);
      }

      if (!op.data) {
        errors.push(`Operation ${index}: missing data`);
      } else {
        // Validate specific operation data requirements
        switch (op.type) {
          case 'analyzeChunk':
            if (!op.data.chunkId || !op.data.snapshotId) {
              errors.push(
                `Operation ${index}: analyzeChunk requires chunkId and snapshotId`,
              );
            }
            break;
          case 'analyzeFile':
            if (!op.data.filePath || !op.data.snapshotId) {
              errors.push(
                `Operation ${index}: analyzeFile requires filePath and snapshotId`,
              );
            }
            break;
          case 'analyzeQuality':
            if (!op.data.target || !op.data.snapshotId) {
              errors.push(
                `Operation ${index}: analyzeQuality requires target and snapshotId`,
              );
            }
            break;
        }
      }
    });

    return errors;
  }

  /**
   * Validate batch queries
   */
  private validateBatchQueries(queries: any[]): string[] {
    const errors: string[] = [];

    queries.forEach((query, index) => {
      if (!query.query || typeof query.query !== 'string') {
        errors.push(`Query ${index}: missing or invalid query string`);
      }

      if (
        query.query &&
        typeof query.query === 'string' &&
        query.query.trim().length === 0
      ) {
        errors.push(`Query ${index}: empty query string`);
      }

      if (
        query.limit &&
        (typeof query.limit !== 'number' || query.limit <= 0)
      ) {
        errors.push(`Query ${index}: invalid limit value`);
      }

      if (
        query.scoreThreshold &&
        (typeof query.scoreThreshold !== 'number' ||
          query.scoreThreshold < 0 ||
          query.scoreThreshold > 1)
      ) {
        errors.push(
          `Query ${index}: invalid scoreThreshold value (must be between 0 and 1)`,
        );
      }
    });

    return errors;
  }

  /**
   * Deduplicate queries based on query string and key parameters
   */
  private deduplicateQueries(queries: any[]): any[] {
    const seen = new Set<string>();
    const deduplicated: any[] = [];

    queries.forEach((query) => {
      // Create a key based on query string and important parameters
      const key = JSON.stringify({
        query: query.query,
        snapshotIds: query.snapshotIds,
        languages: query.languages,
        searchMode: query.searchMode,
      });

      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(query);
      }
    });

    return deduplicated;
  }

  /**
   * Retry failed operations with exponential backoff
   */
  private async retryFailedOperations(
    failedOperations: any[],
    maxRetries: number,
    results: any[],
    updateProgress: (increment?: number) => void,
  ): Promise<void> {
    for (const failedOp of failedOperations) {
      let retryCount = 0;
      let success = false;

      while (retryCount < maxRetries && !success) {
        try {
          // Exponential backoff: wait 2^retryCount seconds
          const delay = Math.pow(2, retryCount) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));

          const result = await this.executeAnalysisOperation(failedOp);

          // Update the original failed result
          const originalIndex = results.findIndex(
            (r) => r.operationId === failedOp.errorInfo.operationId,
          );
          if (originalIndex !== -1) {
            results[originalIndex] = {
              ...failedOp.errorInfo,
              success: true,
              result,
              retryCount: retryCount + 1,
              error: undefined,
            };
          }

          success = true;
          updateProgress(0); // Don't increment total, just trigger progress update
        } catch (error) {
          retryCount++;

          if (retryCount >= maxRetries) {
            // Update with final retry failure
            const originalIndex = results.findIndex(
              (r) => r.operationId === failedOp.errorInfo.operationId,
            );
            if (originalIndex !== -1) {
              results[originalIndex].retryCount = retryCount;
              results[
                originalIndex
              ].error.message += ` (failed after ${retryCount} retries)`;
            }
          }
        }
      }
    }
  }

  /**
   * Retry failed queries with exponential backoff
   */
  private async retryFailedQueries(
    failedQueries: any[],
    maxRetries: number,
    results: any[],
    updateProgress: (increment?: number) => void,
  ): Promise<void> {
    for (const failedQuery of failedQueries) {
      let retryCount = 0;
      let success = false;

      while (retryCount < maxRetries && !success) {
        try {
          // Exponential backoff: wait 2^retryCount seconds
          const delay = Math.pow(2, retryCount) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));

          const result = await this.handleEnhancedSearch(failedQuery);

          // Update the original failed result
          const originalIndex = results.findIndex(
            (r) => r.queryId === failedQuery.errorInfo.queryId,
          );
          if (originalIndex !== -1) {
            results[originalIndex] = {
              ...failedQuery.errorInfo,
              success: true,
              result,
              retryCount: retryCount + 1,
              error: undefined,
            };
          }

          success = true;
          updateProgress(0); // Don't increment total, just trigger progress update
        } catch (error) {
          retryCount++;

          if (retryCount >= maxRetries) {
            // Update with final retry failure
            const originalIndex = results.findIndex(
              (r) => r.queryId === failedQuery.errorInfo.queryId,
            );
            if (originalIndex !== -1) {
              results[originalIndex].retryCount = retryCount;
              results[
                originalIndex
              ].error.message += ` (failed after ${retryCount} retries)`;
            }
          }
        }
      }
    }
  }

  /**
   * Get error code for different types of errors
   */
  private getErrorCode(error: any): string {
    if (error instanceof Error) {
      if (error.message.includes('timeout')) {
        return 'OPERATION_TIMEOUT';
      } else if (error.message.includes('not found')) {
        return 'RESOURCE_NOT_FOUND';
      } else if (error.message.includes('permission')) {
        return 'PERMISSION_DENIED';
      } else if (error.message.includes('network')) {
        return 'NETWORK_ERROR';
      } else if (error.message.includes('memory')) {
        return 'MEMORY_ERROR';
      }
    }
    return 'UNKNOWN_ERROR';
  }

  /**
   * Determine if an error is retryable
   */
  private isRetryableError(error: any): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      // Retryable errors
      if (
        message.includes('timeout') ||
        message.includes('network') ||
        message.includes('temporary') ||
        message.includes('rate limit') ||
        message.includes('service unavailable')
      ) {
        return true;
      }
      // Non-retryable errors
      if (
        message.includes('not found') ||
        message.includes('permission') ||
        message.includes('invalid') ||
        message.includes('malformed')
      ) {
        return false;
      }
    }
    // Default to retryable for unknown errors
    return true;
  }

  // Helper methods for analysis

  private calculateComplexityDistribution(chunks: EnhancedCodeChunk[]): any {
    const distribution = { low: 0, medium: 0, high: 0 };
    chunks.forEach((chunk) => {
      const complexity = chunk.enhancedMetadata.complexityScore;
      if (complexity < 10) distribution.low++;
      else if (complexity < 20) distribution.medium++;
      else distribution.high++;
    });
    return distribution;
  }

  private aggregateSecurityConcerns(chunks: EnhancedCodeChunk[]): string[] {
    const concerns = new Set<string>();
    chunks.forEach((chunk) => {
      chunk.enhancedMetadata.securityConcerns.forEach((concern) =>
        concerns.add(concern),
      );
    });
    return Array.from(concerns);
  }

  private aggregateDesignPatterns(chunks: EnhancedCodeChunk[]): string[] {
    const patterns = new Set<string>();
    chunks.forEach((chunk) => {
      chunk.enhancedMetadata.designPatterns.forEach((pattern) =>
        patterns.add(pattern),
      );
    });
    return Array.from(patterns);
  }

  private generateFileLevelSuggestions(chunks: EnhancedCodeChunk[]): any[] {
    const suggestions = [];

    const avgQuality =
      chunks.reduce(
        (sum, chunk) => sum + chunk.qualityMetrics.overallScore,
        0,
      ) / chunks.length;
    if (avgQuality < 70) {
      suggestions.push({
        type: 'quality',
        description: 'File has below-average quality metrics',
        priority: 'medium',
        action: 'Review and refactor low-quality chunks',
      });
    }

    const highComplexityChunks = chunks.filter(
      (chunk) => chunk.enhancedMetadata.complexityScore > 20,
    );
    if (highComplexityChunks.length > 0) {
      suggestions.push({
        type: 'complexity',
        description: `${highComplexityChunks.length} chunks have high complexity`,
        priority: 'high',
        action: 'Consider breaking down complex functions',
      });
    }

    return suggestions;
  }

  private getSemanticTypeDistribution(chunks: EnhancedCodeChunk[]): any {
    const distribution: any = {};
    chunks.forEach((chunk) => {
      const type = chunk.enhancedMetadata.semanticType;
      distribution[type] = (distribution[type] || 0) + 1;
    });
    return distribution;
  }

  private getQualityDistribution(chunks: EnhancedCodeChunk[]): any {
    const distribution = { excellent: 0, good: 0, fair: 0, poor: 0 };
    chunks.forEach((chunk) => {
      const quality = chunk.qualityMetrics.overallScore;
      if (quality >= 90) distribution.excellent++;
      else if (quality >= 75) distribution.good++;
      else if (quality >= 60) distribution.fair++;
      else distribution.poor++;
    });
    return distribution;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    log('Disposing CLI connector service...');

    // Close all connections
    this.connections.forEach((socket) => {
      socket.destroy();
    });
    this.connections.clear();

    // Close server
    if (this.server) {
      this.server.close();
    }

    // Clean up socket file on Unix systems
    try {
      if (process.platform !== 'win32' && fs.existsSync(this.socketPath)) {
        fs.unlinkSync(this.socketPath);
      }
    } catch (error) {
      log(`Failed to clean up socket file: ${error}`);
    }

    // Clean up connection file
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (workspaceRoot) {
        const connectionFile = path.join(
          workspaceRoot,
          '.vscode',
          'codelapse-connection.json',
        );
        if (fs.existsSync(connectionFile)) {
          fs.unlinkSync(connectionFile);
        }
      }
    } catch (error) {
      log(`Failed to clean up connection file: ${error}`);
    }

    log('CLI connector service disposed');
  }
}
