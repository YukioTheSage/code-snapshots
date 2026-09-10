/* eslint-disable @typescript-eslint/no-explicit-any */
import chalk from 'chalk';
import { UnifiedClient } from '../unifiedClient';
import { printResult } from './output';

export class SnapshotCommands {
  constructor(private client: UnifiedClient) {}

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
      tags: options.tags
        ? options.tags.split(',').map((t: string) => t.trim())
        : [],
      notes: options.notes,
      taskReference: options.taskRef,
      isFavorite: !!options.favorite,
      isSelective: !!options.selective,
      selectedFiles: options.files
        ? options.files.split(',').map((f: string) => f.trim())
        : [],
      silent: true, // CLI operations should be silent by default
    };

    try {
      const result = await this.client.callApi('takeSnapshot', opts);
      printResult(
        {
          success: true,
          snapshot: this.getSnapshotSummary(result.snapshot),
          message: `Snapshot "${opts.description}" created successfully`,
        },
        options,
      );
    } catch (error) {
      printResult(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        options,
      );
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
      // Parsed here rather than inside the try below, because the filter is
      // built before it. Catching locally keeps an invalid `--since` behaving
      // like every other command error -- a failure payload and exit 1 -- rather
      // than escaping to the CLI's fatal-error path.
      let start: number;
      try {
        start = this.parseDate(options.since);
      } catch (error) {
        printResult(
          {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          },
          options,
        );
        return;
      }
      filter.dateRange = { start, end: Date.now() };
    }

    try {
      const snapshots = await this.client.callApi('getSnapshots', filter);

      const summaries = snapshots.map((s: any) => this.getSnapshotSummary(s));

      printResult(
        {
          success: true,
          snapshots: summaries,
          total: summaries.length,
        },
        options,
      );
    } catch (error) {
      printResult(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        options,
      );
    }
  }

  async show(id: string, options: any): Promise<void> {
    try {
      const snapshot = await this.client.callApi('getSnapshot', { id });

      if (!snapshot) {
        printResult(
          {
            success: false,
            error: `Snapshot ${id} not found`,
          },
          options,
        );
        return;
      }

      const result: any = { success: true, snapshot };

      if (options.files) {
        const changes = await this.client.callApi('getSnapshotChanges', {
          snapshotId: id,
        });
        result.changes = changes;
      }

      if (options.content) {
        const content = await this.client.callApi('getSnapshotFileContent', {
          snapshotId: id,
          filePath: options.content,
        });
        result.fileContent = { filePath: options.content, content };
      }

      console.log(JSON.stringify(result));
    } catch (error) {
      printResult(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        options,
      );
    }
  }

  async restore(id: string, options: any): Promise<void> {
    const restoreOpts = {
      createBackupSnapshot: !!options.backup,
      selectedFiles: options.files
        ? options.files.split(',').map((f: string) => f.trim())
        : undefined,
      silent: true,
    };

    try {
      const result = await this.client.callApi('restoreSnapshot', {
        id,
        options: restoreOpts,
      });
      printResult(
        {
          success: true,
          result,
          message: `Snapshot ${id} restored successfully`,
        },
        options,
      );
    } catch (error) {
      printResult(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        options,
      );
    }
  }

  async delete(id: string, options: any): Promise<void> {
    try {
      const result = await this.client.callApi('deleteSnapshot', { id });
      printResult(
        {
          success: true,
          result,
          message: `Snapshot ${id} deleted successfully`,
        },
        options,
      );
    } catch (error) {
      printResult(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        options,
      );
    }
  }

  async compare(id1: string, id2: string, options: any): Promise<void> {
    try {
      const result = await this.client.callApi('compareSnapshots', {
        snapshotId1: id1,
        snapshotId2: id2,
      });
      printResult(
        {
          success: true,
          comparison: result,
          summary: {
            addedFiles: result.addedFiles?.length || 0,
            removedFiles: result.removedFiles?.length || 0,
            modifiedFiles: result.modifiedFiles?.length || 0,
            identicalFiles: result.identicalFiles?.length || 0,
          },
        },
        options,
      );
    } catch (error) {
      printResult(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        options,
      );
    }
  }

  async navigate(direction: string): Promise<void> {
    // `navigate` takes no options object, and the code it replaces printed JSON
    // unconditionally, so `{ json: true }` preserves the existing output while
    // still recording failure. Its option surface is Plan 06's concern.
    if (!['previous', 'next'].includes(direction)) {
      printResult(
        {
          success: false,
          error: 'Direction must be "previous" or "next"',
        },
        { json: true },
      );
      return;
    }

    try {
      const result = await this.client.callApi('navigateSnapshot', {
        direction,
      });
      printResult(
        {
          success: true,
          navigation: result,
          message: `Navigated to ${direction} snapshot`,
        },
        { json: true },
      );
    } catch (error) {
      printResult(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        { json: true },
      );
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
        case 'h':
          return now - amount * 60 * 60 * 1000;
        case 'd':
          return now - amount * 24 * 60 * 60 * 1000;
        case 'w':
          return now - amount * 7 * 24 * 60 * 60 * 1000;
      }
    }

    // Try to parse as ISO date
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date.getTime();
    }

    throw new Error(
      `Invalid date format: ${dateStr}. Use ISO string or relative format like "1h", "2d", "1w"`,
    );
  }
}
