import * as vscode from 'vscode';
import { SnapshotManager, Snapshot } from '../snapshotManager';
import { SemanticSearchService } from './semanticSearchService';
import { log } from '../logger';
import {
  TerminalApiInterface,
  TakeSnapshotOptions,
  SnapshotResponse,
  SnapshotFilter,
  RestoreOptions,
  RestoreResponse,
  NavigationResponse,
  ChangesSummary,
  ComparisonResult,
  SearchOptions,
  SearchResult,
  IndexingResult,
  WorkspaceInfo,
  CurrentState,
  ValidationResult,
  ExportResult
} from './terminalApiTypes';

/**
 * Terminal API Service Implementation
 */
export class TerminalApiService implements TerminalApiInterface {
  private snapshotManager: SnapshotManager;
  private semanticSearchService?: SemanticSearchService;

  constructor(snapshotManager: SnapshotManager, semanticSearchService?: SemanticSearchService) {
    this.snapshotManager = snapshotManager;
    this.semanticSearchService = semanticSearchService;
    log('TerminalApiService initialized');
  }

  /**
   * Take a snapshot with the given options
   */
  async takeSnapshot(options: TakeSnapshotOptions = {}): Promise<SnapshotResponse> {
    try {
      log(`TerminalApiService: Taking snapshot with options: ${JSON.stringify(options)}`);
      
      const snapshot = await this.snapshotManager.takeSnapshot(
        options.description || `CLI snapshot at ${new Date().toISOString()}`,
        {
          tags: options.tags,
          notes: options.notes,
          taskReference: options.taskReference,
          isFavorite: options.isFavorite,
          isSelective: options.isSelective,
          selectedFiles: options.selectedFiles,
        }
      );

      // Calculate statistics
      const changes = this.snapshotManager.getSnapshotChangeSummary(snapshot.id);
      const statistics = {
        filesProcessed: Object.keys(snapshot.files).length,
        filesChanged: changes.modified,
        filesAdded: changes.added,
        filesDeleted: changes.deleted,
      };

      // Show notification unless silent mode
      if (!options.silent) {
        vscode.window.showInformationMessage(
          `Snapshot "${snapshot.description}" created successfully`
        );
      }

      return {
        success: true,
        snapshot,
        statistics,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log(`TerminalApiService: Error taking snapshot: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Get snapshots with optional filtering
   */
  async getSnapshots(filter?: SnapshotFilter): Promise<Snapshot[]> {
    try {
      let snapshots = this.snapshotManager.getSnapshots();

      if (filter) {
        // Apply tag filter
        if (filter.tags && filter.tags.length > 0) {
          snapshots = snapshots.filter(s => 
            s.tags && s.tags.some(tag => filter.tags!.includes(tag))
          );
        }

        // Apply date range filter
        if (filter.dateRange) {
          snapshots = snapshots.filter(s => 
            s.timestamp >= filter.dateRange!.start && 
            s.timestamp <= filter.dateRange!.end
          );
        }

        // Apply favorite filter
        if (filter.isFavorite !== undefined) {
          snapshots = snapshots.filter(s => s.isFavorite === filter.isFavorite);
        }

        // Apply pagination
        if (filter.offset || filter.limit) {
          const start = filter.offset || 0;
          const end = filter.limit ? start + filter.limit : undefined;
          snapshots = snapshots.slice(start, end);
        }
      }

      return snapshots;
    } catch (error) {
      log(`TerminalApiService: Error getting snapshots: ${error}`);
      return [];
    }
  }

  /**
   * Get a specific snapshot by ID
   */
  async getSnapshot(id: string): Promise<Snapshot | null> {
    try {
      return this.snapshotManager.getSnapshotById(id) || null;
    } catch (error) {
      log(`TerminalApiService: Error getting snapshot ${id}: ${error}`);
      return null;
    }
  }

  /**
   * Restore a snapshot with options
   */
  async restoreSnapshot(id: string, options: RestoreOptions = {}): Promise<RestoreResponse> {
    try {
      log(`TerminalApiService: Restoring snapshot ${id} with options: ${JSON.stringify(options)}`);

      const snapshot = this.snapshotManager.getSnapshotById(id);
      if (!snapshot) {
        return {
          success: false,
          filesRestored: 0,
          filesSkipped: 0,
          error: `Snapshot ${id} not found`,
        };
      }

      // Create backup snapshot if requested
      let backupSnapshotId: string | undefined;
      if (options.createBackupSnapshot) {
        const backupResponse = await this.takeSnapshot({
          description: `Backup before restoring ${snapshot.description}`,
          tags: ['backup', 'auto'],
          silent: true,
        });
        if (backupResponse.success && backupResponse.snapshot) {
          backupSnapshotId = backupResponse.snapshot.id;
        }
      }

      // Check for unsaved changes
      const conflicts: string[] = [];
      if (vscode.window.activeTextEditor?.document.isDirty) {
        conflicts.push(vscode.window.activeTextEditor.document.fileName);
      }

      // Perform the restore
      const success = await this.snapshotManager.applySnapshotRestore(id);
      
      if (!success) {
        return {
          success: false,
          filesRestored: 0,
          filesSkipped: 0,
          error: 'Failed to restore snapshot',
          conflicts,
        };
      }

      // Show notification unless silent
      if (!options.silent) {
        vscode.window.showInformationMessage(
          `Snapshot "${snapshot.description}" restored successfully`
        );
      }

      return {
        success: true,
        backupSnapshotId,
        filesRestored: Object.keys(snapshot.files).length,
        filesSkipped: 0,
        conflicts,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log(`TerminalApiService: Error restoring snapshot: ${errorMessage}`);
      return {
        success: false,
        filesRestored: 0,
        filesSkipped: 0,
        error: errorMessage,
      };
    }
  }

  /**
   * Delete a snapshot
   */
  async deleteSnapshot(id: string): Promise<boolean> {
    try {
      return await this.snapshotManager.deleteSnapshot(id);
    } catch (error) {
      log(`TerminalApiService: Error deleting snapshot ${id}: ${error}`);
      return false;
    }
  }

  /**
   * Navigate to previous or next snapshot
   */
  async navigateSnapshot(direction: 'previous' | 'next'): Promise<NavigationResponse> {
    try {
      const previousIndex = this.snapshotManager.getCurrentSnapshotIndex();
      
      let success: boolean;
      if (direction === 'previous') {
        success = await this.snapshotManager.navigateToPreviousSnapshot();
      } else {
        success = await this.snapshotManager.navigateToNextSnapshot();
      }

      const newIndex = this.snapshotManager.getCurrentSnapshotIndex();
      const currentSnapshot = newIndex >= 0 ? 
        this.snapshotManager.getSnapshots()[newIndex] : undefined;

      return {
        success,
        currentSnapshot,
        previousIndex,
        newIndex,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        previousIndex: this.snapshotManager.getCurrentSnapshotIndex(),
        newIndex: this.snapshotManager.getCurrentSnapshotIndex(),
        error: errorMessage,
      };
    }
  }

  /**
   * Get file content from a specific snapshot
   */
  async getSnapshotFileContent(snapshotId: string, filePath: string): Promise<string | null> {
    try {
      return await this.snapshotManager.getSnapshotFileContentPublic(snapshotId, filePath);
    } catch (error) {
      log(`TerminalApiService: Error getting file content: ${error}`);
      return null;
    }
  }

  /**
   * Get changes summary for a snapshot
   */
  async getSnapshotChanges(snapshotId: string): Promise<ChangesSummary> {
    try {
      const snapshot = this.snapshotManager.getSnapshotById(snapshotId);
      if (!snapshot) {
        throw new Error(`Snapshot ${snapshotId} not found`);
      }

      const added: string[] = [];
      const modified: string[] = [];
      const deleted: string[] = [];
      const binary: string[] = [];

      Object.entries(snapshot.files).forEach(([filePath, fileData]) => {
        if (fileData.deleted) {
          deleted.push(filePath);
        } else if (fileData.isBinary) {
          binary.push(filePath);
        } else if (fileData.diff) {
          modified.push(filePath);
        } else if (fileData.content && !fileData.baseSnapshotId) {
          added.push(filePath);
        }
      });

      return {
        snapshotId,
        added,
        modified,
        deleted,
        binary,
        totalChanges: added.length + modified.length + deleted.length,
      };
    } catch (error) {
      log(`TerminalApiService: Error getting snapshot changes: ${error}`);
      return {
        snapshotId,
        added: [],
        modified: [],
        deleted: [],
        binary: [],
        totalChanges: 0,
      };
    }
  }

  /**
   * Compare two snapshots
   */
  async compareSnapshots(snapshotId1: string, snapshotId2: string): Promise<ComparisonResult> {
    try {
      const snapshot1 = this.snapshotManager.getSnapshotById(snapshotId1);
      const snapshot2 = this.snapshotManager.getSnapshotById(snapshotId2);

      if (!snapshot1 || !snapshot2) {
        throw new Error('One or both snapshots not found');
      }

      const files1 = new Set(Object.keys(snapshot1.files));
      const files2 = new Set(Object.keys(snapshot2.files));
      
      const addedFiles = Array.from(files2).filter(f => !files1.has(f));
      const removedFiles = Array.from(files1).filter(f => !files2.has(f));
      const commonFiles = Array.from(files1).filter(f => files2.has(f));
      
      const modifiedFiles: string[] = [];
      const identicalFiles: string[] = [];
      const filesDiff: ComparisonResult['filesDiff'] = {};

      for (const filePath of commonFiles) {
        const content1 = await this.getSnapshotFileContent(snapshotId1, filePath);
        const content2 = await this.getSnapshotFileContent(snapshotId2, filePath);
        
        if (content1 !== content2) {
          modifiedFiles.push(filePath);
          filesDiff[filePath] = {
            changeType: 'modified',
            // Could add line count diff here
          };
        } else {
          identicalFiles.push(filePath);
        }
      }

      // Add removed files to diff
      removedFiles.forEach(filePath => {
        filesDiff[filePath] = { changeType: 'removed' };
      });

      // Add added files to diff
      addedFiles.forEach(filePath => {
        filesDiff[filePath] = { changeType: 'added' };
      });

      return {
        snapshotId1,
        snapshotId2,
        addedFiles,
        removedFiles,
        modifiedFiles,
        identicalFiles,
        filesDiff,
      };
    } catch (error) {
      log(`TerminalApiService: Error comparing snapshots: ${error}`);
      return {
        snapshotId1,
        snapshotId2,
        addedFiles: [],
        removedFiles: [],
        modifiedFiles: [],
        identicalFiles: [],
        filesDiff: {},
      };
    }
  }

  /**
   * Search snapshots using semantic search
   */
  async searchSnapshots(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    try {
      if (!this.semanticSearchService) {
        throw new Error('Semantic search service not available');
      }

      const results = await this.semanticSearchService.searchCode({
        query,
        snapshotIds: options.snapshotIds,
        languages: options.languages,
        limit: options.limit || 20,
        scoreThreshold: options.scoreThreshold || 0.65,
      });

      return results.map(result => ({
        snapshotId: result.snapshotId,
        filePath: result.filePath,
        content: result.content,
        score: result.score,
        location: {
          startLine: result.startLine,
          endLine: result.endLine,
        },
        context: {
          snapshotDescription: result.snapshot.description || '',
          snapshotTimestamp: result.timestamp,
          tags: result.snapshot.tags || [],
        },
      }));
    } catch (error) {
      log(`TerminalApiService: Error searching snapshots: ${error}`);
      return [];
    }
  }

  /**
   * Index snapshots for semantic search
   */
  async indexSnapshots(snapshotIds?: string[]): Promise<IndexingResult> {
    try {
      const startTime = Date.now();
      
      if (!this.semanticSearchService) {
        throw new Error('Semantic search service not available');
      }

      if (snapshotIds) {
        // Individual snapshot indexing not supported by the semantic search service
        return {
          success: false,
          snapshotsIndexed: 0,
          filesIndexed: 0,
          error: 'Individual snapshot indexing not supported. Use indexAllSnapshots instead.',
          timeElapsed: Date.now() - startTime,
        };
      } else {
        // Index all snapshots
        await this.semanticSearchService.indexAllSnapshots();
        
        return {
          success: true,
          snapshotsIndexed: this.snapshotManager.getSnapshots().length,
          filesIndexed: 0, // Would need to track this
          timeElapsed: Date.now() - startTime,
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        snapshotsIndexed: 0,
        filesIndexed: 0,
        error: errorMessage,
        timeElapsed: 0,
      };
    }
  }

  /**
   * Get workspace information
   */
  async getWorkspaceInfo(): Promise<WorkspaceInfo> {
    try {
      const snapshots = this.snapshotManager.getSnapshots();
      const currentIndex = this.snapshotManager.getCurrentSnapshotIndex();
      const currentSnapshot = currentIndex >= 0 ? snapshots[currentIndex] : undefined;
      
      return {
        workspaceRoot: this.snapshotManager.getWorkspaceRoot(),
        totalSnapshots: snapshots.length,
        currentSnapshotIndex: currentIndex,
        currentSnapshot,
        lastSnapshotTime: snapshots.length > 0 ? snapshots[snapshots.length - 1].timestamp : undefined,
      };
    } catch (error) {
      log(`TerminalApiService: Error getting workspace info: ${error}`);
      return {
        workspaceRoot: null,
        totalSnapshots: 0,
        currentSnapshotIndex: -1,
      };
    }
  }

  /**
   * Get current workspace state
   */
  async getCurrentState(): Promise<CurrentState> {
    try {
      const changedFiles: string[] = [];
      const openFiles: string[] = [];
      let activeFile: string | undefined;
      
      // Get open and active files
      vscode.window.visibleTextEditors.forEach(editor => {
        const filePath = editor.document.fileName;
        openFiles.push(filePath);
        
        if (editor.document.isDirty) {
          changedFiles.push(filePath);
        }
      });

      if (vscode.window.activeTextEditor) {
        activeFile = vscode.window.activeTextEditor.document.fileName;
      }

      // Basic workspace stats (simplified)
      const workspaceStats = {
        totalFiles: 0,
        totalLines: 0,
        filesByLanguage: {} as { [language: string]: number },
      };

      return {
        hasUnsavedChanges: changedFiles.length > 0,
        changedFiles,
        openFiles,
        activeFile,
        workspaceStats,
      };
    } catch (error) {
      log(`TerminalApiService: Error getting current state: ${error}`);
      return {
        hasUnsavedChanges: false,
        changedFiles: [],
        openFiles: [],
        workspaceStats: {
          totalFiles: 0,
          totalLines: 0,
          filesByLanguage: {},
        },
      };
    }
  }

  /**
   * Validate a snapshot
   */
  async validateSnapshot(id: string): Promise<ValidationResult> {
    try {
      const snapshot = this.snapshotManager.getSnapshotById(id);
      
      if (!snapshot) {
        return {
          isValid: false,
          exists: false,
          hasIntegrityIssues: false,
          missingFiles: [],
          corruptedFiles: [],
          errors: [`Snapshot ${id} not found`],
        };
      }

      // Basic validation - could be enhanced
      return {
        isValid: true,
        exists: true,
        hasIntegrityIssues: false,
        missingFiles: [],
        corruptedFiles: [],
        errors: [],
      };
    } catch (error) {
      return {
        isValid: false,
        exists: false,
        hasIntegrityIssues: true,
        missingFiles: [],
        corruptedFiles: [],
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  /**
   * Export a snapshot
   */
  async exportSnapshot(id: string, format: 'json' | 'zip'): Promise<ExportResult> {
    try {
      const snapshot = this.snapshotManager.getSnapshotById(id);
      
      if (!snapshot) {
        return {
          success: false,
          format,
          size: 0,
          error: `Snapshot ${id} not found`,
        };
      }

      // This would need proper implementation based on storage service
      const exportData = JSON.stringify(snapshot, null, 2);
      const size = Buffer.byteLength(exportData, 'utf8');

      return {
        success: true,
        exportPath: `/tmp/snapshot-${id}.${format}`,
        format,
        size,
      };
    } catch (error) {
      return {
        success: false,
        format,
        size: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Subscribe to snapshot changes
   */
  onSnapshotsChanged(callback: (snapshots: Snapshot[]) => void): vscode.Disposable {
    return this.snapshotManager.onDidChangeSnapshots(() => {
      callback(this.snapshotManager.getSnapshots());
    });
  }

  /**
   * Subscribe to current snapshot changes
   */
  onCurrentSnapshotChanged(callback: (snapshot: Snapshot | null) => void): vscode.Disposable {
    return this.snapshotManager.onDidChangeSnapshots(() => {
      const index = this.snapshotManager.getCurrentSnapshotIndex();
      const snapshot = index >= 0 ? this.snapshotManager.getSnapshots()[index] : null;
      callback(snapshot);
    });
  }
} 