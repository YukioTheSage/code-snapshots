import chalk from 'chalk';
import { UnifiedClient } from '../unifiedClient';
import type {
  ListFilesOptions,
  ViewFileOptions,
  CompareFileOptions,
  BaseCommandOptions,
} from '../types/options';

interface DiffEntry {
  type: 'header' | 'context' | 'delete' | 'insert';
  content: string;
  oldStart?: number;
  oldLength?: number;
  newStart?: number;
  newLength?: number;
}

export interface FileInfo {
  path: string;
  size: number;
  modified: string;
  status: 'added' | 'modified' | 'deleted' | 'unchanged';
  linesAdded?: number;
  linesRemoved?: number;
  contentType?: string;
}

export class FilesCommands {
  constructor(private client: UnifiedClient) {}

  async list(
    snapshotId: string,
    options: Partial<ListFilesOptions> = {},
  ): Promise<void> {
    const opts = {
      snapshotId,
      changedOnly: !!options.changedOnly,
      includeContent: !!options.content,
      pattern: options.pattern,
      sortBy: options.sortBy || 'path',
      sortOrder: options.sortOrder || 'asc',
    };

    try {
      const result = await this.client.callApi('listSnapshotFiles', opts);

      if (options.json) {
        console.log(
          JSON.stringify({
            success: true,
            snapshotId,
            files: result.files || [],
            totalFiles: result.totalFiles || 0,
            changedFiles: result.changedFiles || 0,
          }),
        );
      } else {
        const files = result.files || [];

        if (files.length === 0) {
          console.log(chalk.yellow(`No files found in snapshot ${snapshotId}`));
          return;
        }

        const title = opts.changedOnly ? 'Changed Files' : 'All Files';
        console.log(
          chalk.blue(`${title} in Snapshot ${snapshotId} (${files.length}):`),
        );
        console.log('');

        files.forEach((file: FileInfo) => {
          const statusIcon = this.getStatusIcon(file.status);
          const sizeFormatted = this.formatFileSize(file.size);
          const modifiedDate = new Date(file.modified).toLocaleString();

          console.log(`${statusIcon} ${chalk.cyan(file.path)}`);
          console.log(
            `    Size: ${chalk.yellow(sizeFormatted)} | Modified: ${chalk.gray(
              modifiedDate,
            )}`,
          );

          if (
            file.linesAdded !== undefined ||
            file.linesRemoved !== undefined
          ) {
            const added = file.linesAdded || 0;
            const removed = file.linesRemoved || 0;
            console.log(
              `    Changes: ${chalk.green(`+${added}`)} ${chalk.red(
                `-${removed}`,
              )}`,
            );
          }

          console.log('');
        });

        // Summary
        if (result.totalFiles !== files.length) {
          console.log(chalk.blue('Summary:'));
          console.log(`Total files: ${result.totalFiles}`);
          if (result.changedFiles) {
            console.log(`Changed files: ${result.changedFiles}`);
          }
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: errorMessage }));
      } else {
        console.error(
          chalk.red('✗ Failed to list snapshot files:'),
          errorMessage,
        );
      }
    }
  }

  async show(
    snapshotId: string,
    filePath: string,
    options: Partial<
      ViewFileOptions & {
        content?: boolean;
        metadata?: boolean;
        context?: string;
      }
    > = {},
  ): Promise<void> {
    const opts = {
      snapshotId,
      filePath,
      // `!== false`, not `!options.noX`: Commander sets `options.content` to
      // false for `--no-content`, so the `noContent` key never exists and the
      // documented flags did nothing.
      includeContent: options.content !== false,
      includeMetadata: options.metadata !== false,
      highlightSyntax: options.syntax !== false,
      lineNumbers: options.lineNumbers !== false,
      contextLines: parseInt(options.context ?? '0') || 0,
    };

    try {
      const result = await this.client.callApi('getSnapshotFile', opts);

      if (options.json) {
        console.log(
          JSON.stringify({
            success: true,
            snapshotId,
            filePath,
            file: result.file || {},
            content: result.content || '',
          }),
        );
      } else {
        const file = result.file;
        const content = result.content || '';

        console.log(
          chalk.blue(`File: ${chalk.cyan(filePath)} (Snapshot: ${snapshotId})`),
        );
        console.log('='.repeat(60));

        if (opts.includeMetadata && file) {
          console.log(`Size: ${chalk.yellow(this.formatFileSize(file.size))}`);
          console.log(
            `Modified: ${chalk.gray(new Date(file.modified).toLocaleString())}`,
          );
          console.log(`Status: ${this.getStatusText(file.status)}`);

          if (file.contentType) {
            console.log(`Type: ${chalk.blue(file.contentType)}`);
          }

          console.log('');
        }

        if (opts.includeContent) {
          if (content) {
            const lines = content.split('\n');
            lines.forEach((line: string, index: number) => {
              const lineNum = opts.lineNumbers
                ? chalk.gray(`${(index + 1).toString().padStart(4, ' ')}: `)
                : '';
              console.log(`${lineNum}${line}`);
            });
          } else {
            console.log(chalk.gray('(Empty file or binary content)'));
          }
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: errorMessage }));
      } else {
        console.error(chalk.red('✗ Failed to show file:'), errorMessage);
      }
    }
  }

  async compare(
    snapshotId1: string,
    snapshotId2: string,
    filePath: string,
    options: Partial<CompareFileOptions> = {},
  ): Promise<void> {
    const opts = {
      snapshotId1,
      snapshotId2,
      filePath,
      contextLines:
        (typeof options.context === 'string'
          ? parseInt(String(options.context))
          : options.context) || 3,
      ignoreWhitespace: !!options.ignoreWhitespace,
      unified: !options.sideBySide,
    };

    try {
      const result = await this.client.callApi('compareSnapshotFile', opts);

      if (options.json) {
        console.log(
          JSON.stringify({
            success: true,
            snapshotId1,
            snapshotId2,
            filePath,
            differences: result.differences || [],
            summary: result.summary || {},
          }),
        );
      } else {
        console.log(chalk.blue(`Comparing ${chalk.cyan(filePath)}`));
        console.log(
          `${chalk.gray('From:')} ${snapshotId1} ${chalk.gray(
            'To:',
          )} ${snapshotId2}`,
        );
        console.log('='.repeat(60));

        const differences = result.differences || [];
        const summary = result.summary || {};

        if (differences.length === 0) {
          console.log(chalk.green('✓ Files are identical'));
          return;
        }

        differences.forEach((diff: DiffEntry) => {
          if (diff.type === 'header') {
            console.log(
              chalk.blue(
                `@@ -${diff.oldStart},${diff.oldLength} +${diff.newStart},${diff.newLength} @@`,
              ),
            );
          } else if (diff.type === 'context') {
            console.log(` ${diff.content}`);
          } else if (diff.type === 'delete') {
            console.log(chalk.red(`-${diff.content}`));
          } else if (diff.type === 'insert') {
            console.log(chalk.green(`+${diff.content}`));
          }
        });

        console.log('');
        console.log(chalk.blue('Summary:'));
        console.log(`Lines added: ${chalk.green(summary.linesAdded || 0)}`);
        console.log(`Lines removed: ${chalk.red(summary.linesRemoved || 0)}`);
        console.log(
          `Lines unchanged: ${chalk.gray(summary.linesUnchanged || 0)}`,
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: errorMessage }));
      } else {
        console.error(chalk.red('✗ Failed to compare files:'), errorMessage);
      }
    }
  }

  async restore(
    snapshotId: string,
    filePath: string,
    options: Partial<
      BaseCommandOptions & { to?: string; backup?: boolean; force?: boolean }
    > = {},
  ): Promise<void> {
    const opts = {
      snapshotId,
      filePath,
      targetPath: options.to || filePath,
      // `--no-backup` sets `options.backup` to false; `noBackup` is never set.
      createBackup: options.backup !== false,
      force: !!options.force,
    };

    try {
      const result = await this.client.callApi('restoreSnapshotFile', opts);

      if (options.json) {
        console.log(
          JSON.stringify({
            success: true,
            snapshotId,
            filePath,
            targetPath: opts.targetPath,
            backupPath: result.backupPath,
            message: 'File restored successfully',
          }),
        );
      } else {
        console.log(chalk.green('✓ File restored successfully'));
        console.log(`From snapshot: ${chalk.cyan(snapshotId)}`);
        console.log(`File: ${chalk.yellow(filePath)}`);
        console.log(`Restored to: ${chalk.cyan(opts.targetPath)}`);

        if (result.backupPath) {
          console.log(`Backup created: ${chalk.gray(result.backupPath)}`);
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: errorMessage }));
      } else {
        console.error(chalk.red('✗ Failed to restore file:'), errorMessage);
      }
    }
  }

  async history(
    filePath: string,
    options: Partial<
      BaseCommandOptions & {
        limit?: string;
        since?: string;
        content?: boolean;
        sortOrder?: string;
      }
    > = {},
  ): Promise<void> {
    const opts = {
      filePath,
      limit: parseInt(options.limit ?? '') || 50,
      since: options.since,
      includeContent: !!options.content,
      sortOrder: options.sortOrder || 'desc',
    };

    try {
      const result = await this.client.callApi('getFileHistory', opts);

      if (options.json) {
        console.log(
          JSON.stringify({
            success: true,
            filePath,
            history: result.history || [],
            totalVersions: result.totalVersions || 0,
          }),
        );
      } else {
        const history = result.history || [];

        if (history.length === 0) {
          console.log(chalk.yellow(`No history found for file: ${filePath}`));
          return;
        }

        console.log(
          chalk.blue(
            `File History: ${chalk.cyan(filePath)} (${
              history.length
            } versions)`,
          ),
        );
        console.log('='.repeat(60));

        history.forEach(
          (
            entry: {
              snapshot: Record<string, any>;
              file: Record<string, any>;
            },
            index: number,
          ) => {
            const isLatest = index === 0;
            const snapshot = entry.snapshot;
            const file = entry.file;

            const marker = isLatest
              ? chalk.green('● (latest)')
              : chalk.gray('●');
            console.log(`${marker} ${chalk.cyan(snapshot.id)}`);
            console.log(`    ${snapshot.description}`);
            console.log(
              `    ${chalk.gray(
                new Date(snapshot.timestamp).toLocaleString(),
              )}`,
            );

            if (file.status !== 'unchanged') {
              const statusText = this.getStatusText(file.status);
              console.log(`    Status: ${statusText}`);

              if (
                file.linesAdded !== undefined ||
                file.linesRemoved !== undefined
              ) {
                const added = file.linesAdded || 0;
                const removed = file.linesRemoved || 0;
                console.log(
                  `    Changes: ${chalk.green(`+${added}`)} ${chalk.red(
                    `-${removed}`,
                  )}`,
                );
              }
            }

            if (snapshot.tags && snapshot.tags.length > 0) {
              console.log(
                `    Tags: ${snapshot.tags
                  .map((tag: string) => chalk.blue(`#${tag}`))
                  .join(' ')}`,
              );
            }

            console.log('');
          },
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: errorMessage }));
      } else {
        console.error(chalk.red('✗ Failed to get file history:'), errorMessage);
      }
    }
  }

  async export(
    snapshotId: string,
    filePath: string,
    outputPath: string,
    options: Partial<
      BaseCommandOptions & { format?: string; metadata?: boolean }
    > = {},
  ): Promise<void> {
    const opts = {
      snapshotId,
      filePath,
      outputPath,
      format: options.format || 'original',
      includeMetadata: !!options.metadata,
    };

    try {
      const result = await this.client.callApi('exportSnapshotFile', opts);

      if (options.json) {
        console.log(
          JSON.stringify({
            success: true,
            snapshotId,
            filePath,
            outputPath: result.outputPath,
            format: opts.format,
            message: 'File exported successfully',
          }),
        );
      } else {
        console.log(chalk.green('✓ File exported successfully'));
        console.log(
          `From: ${chalk.cyan(snapshotId)}:${chalk.yellow(filePath)}`,
        );
        console.log(`To: ${chalk.cyan(result.outputPath)}`);
        console.log(`Format: ${chalk.blue(opts.format)}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: errorMessage }));
      } else {
        console.error(chalk.red('✗ Failed to export file:'), errorMessage);
      }
    }
  }

  private getStatusIcon(status: string): string {
    switch (status) {
      case 'added':
        return chalk.green('+');
      case 'modified':
        return chalk.yellow('~');
      case 'deleted':
        return chalk.red('-');
      case 'unchanged':
        return chalk.gray('=');
      default:
        return chalk.gray('?');
    }
  }

  private getStatusText(status: string): string {
    switch (status) {
      case 'added':
        return chalk.green('Added');
      case 'modified':
        return chalk.yellow('Modified');
      case 'deleted':
        return chalk.red('Deleted');
      case 'unchanged':
        return chalk.gray('Unchanged');
      default:
        return chalk.gray('Unknown');
    }
  }

  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB'];
    const base = 1024;
    const digitGroups = Math.floor(Math.log(bytes) / Math.log(base));
    const size = (bytes / Math.pow(base, digitGroups)).toFixed(1);

    return `${size} ${units[digitGroups]}`;
  }
}
