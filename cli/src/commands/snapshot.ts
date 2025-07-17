import chalk from 'chalk';
import { CodeLapseClient } from '../client';

export class SnapshotCommands {
  constructor(private client: CodeLapseClient) {}

  private getSnapshotSummary(snapshot: any) {
    return {
      id: snapshot.id,
      description: snapshot.description,
      timestamp: snapshot.timestamp,
      gitBranch: snapshot.gitBranch,
      gitCommitHash: snapshot.gitCommitHash,
      tags: snapshot.tags,
      notes: snapshot.notes,
      taskReference: snapshot.taskReference,
      isFavorite: snapshot.isFavorite,
      isSelective: snapshot.isSelective,
      selectedFiles: snapshot.selectedFiles,
    };
  }

  async create(description: string, options: any): Promise<void> {
    const opts = {
      description: description || 'CLI snapshot',
      tags: options.tags ? options.tags.split(',').map((t: string) => t.trim()) : [],
      notes: options.notes,
      taskReference: options.taskRef,
      isFavorite: !!options.favorite,
      isSelective: !!options.selective,
      selectedFiles: options.files ? options.files.split(',').map((f: string) => f.trim()) : [],
      silent: true, // CLI operations should be silent by default
    };

    try {
      const result = await this.client.callApi('takeSnapshot', opts);
      console.log(JSON.stringify({
        success: true,
        snapshot: this.getSnapshotSummary(result.snapshot),
        message: `Snapshot "${opts.description}" created successfully`
      }));
    } catch (error) {
      console.log(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  }

  async list(options: any): Promise<void> {
    const filter: any = {};
    
    if (options.tags) {
      filter.tags = options.tags.split(',').map((t: string) => t.trim());
    }
    
    if (options.favorites) {
      filter.isFavorite = true;
    }
    
    if (options.limit) {
      filter.limit = parseInt(options.limit);
    }
    
    if (options.since) {
      filter.dateRange = { start: this.parseDate(options.since), end: Date.now() };
    }

    try {
      const snapshots = await this.client.callApi('getSnapshots', filter);

      const summaries = snapshots.map((s: any) => this.getSnapshotSummary(s));

      console.log(JSON.stringify({
        success: true,
        snapshots: summaries,
        total: summaries.length
      }));
    } catch (error) {
      console.log(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  }

  async show(id: string, options: any): Promise<void> {
    try {
      const snapshot = await this.client.callApi('getSnapshot', { id });
      
      if (!snapshot) {
        console.log(JSON.stringify({
          success: false,
          error: `Snapshot ${id} not found`
        }));
        return;
      }

      const result: any = { success: true, snapshot };

      if (options.files) {
        const changes = await this.client.callApi('getSnapshotChanges', { snapshotId: id });
        result.changes = changes;
      }

      if (options.content) {
        const content = await this.client.callApi('getSnapshotFileContent', {
          snapshotId: id,
          filePath: options.content
        });
        result.fileContent = { filePath: options.content, content };
      }

      console.log(JSON.stringify(result));
    } catch (error) {
      console.log(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  }

  async restore(id: string, options: any): Promise<void> {
    const restoreOpts = {
      createBackupSnapshot: !!options.backup,
      selectedFiles: options.files ? options.files.split(',').map((f: string) => f.trim()) : undefined,
      silent: true,
    };

    try {
      const result = await this.client.callApi('restoreSnapshot', { id, options: restoreOpts });
      console.log(JSON.stringify({
        success: true,
        result,
        message: `Snapshot ${id} restored successfully`
      }));
    } catch (error) {
      console.log(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  }

  async delete(id: string, options: any): Promise<void> {
    try {
      const result = await this.client.callApi('deleteSnapshot', { id });
      console.log(JSON.stringify({
        success: true,
        result,
        message: `Snapshot ${id} deleted successfully`
      }));
    } catch (error) {
      console.log(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  }

  async compare(id1: string, id2: string, options: any): Promise<void> {
    try {
      const result = await this.client.callApi('compareSnapshots', { snapshotId1: id1, snapshotId2: id2 });
      console.log(JSON.stringify({
        success: true,
        comparison: result,
        summary: {
          addedFiles: result.addedFiles?.length || 0,
          removedFiles: result.removedFiles?.length || 0,
          modifiedFiles: result.modifiedFiles?.length || 0,
          identicalFiles: result.identicalFiles?.length || 0,
        }
      }));
    } catch (error) {
      console.log(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  }

  async navigate(direction: string): Promise<void> {
    if (!['previous', 'next'].includes(direction)) {
      console.log(JSON.stringify({
        success: false,
        error: 'Direction must be "previous" or "next"'
      }));
      return;
    }

    try {
      const result = await this.client.callApi('navigateSnapshot', { direction });
      console.log(JSON.stringify({
        success: true,
        navigation: result,
        message: `Navigated to ${direction} snapshot`
      }));
    } catch (error) {
      console.log(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  }

  private parseDate(dateStr: string): number {
    // Handle relative dates like "1h", "2d", "1w"
    const relativeMatch = dateStr.match(/^(\d+)([hdw])$/);
    if (relativeMatch) {
      const amount = parseInt(relativeMatch[1]);
      const unit = relativeMatch[2];
      const now = Date.now();
      
      switch (unit) {
        case 'h': return now - (amount * 60 * 60 * 1000);
        case 'd': return now - (amount * 24 * 60 * 60 * 1000);
        case 'w': return now - (amount * 7 * 24 * 60 * 60 * 1000);
      }
    }
    
    // Try to parse as ISO date
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date.getTime();
    }
    
    throw new Error(`Invalid date format: ${dateStr}. Use ISO string or relative format like "1h", "2d", "1w"`);
  }
} 