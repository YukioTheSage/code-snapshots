import chalk from 'chalk';
import { UnifiedClient } from '../unifiedClient';
import type { BaseCommandOptions, PaginationOptions } from '../types/options';
import { printResult } from './output';
import { setFailure } from '../exitState';

/** Raw snapshot data returned from the API */
interface SnapshotRecord {
  id: string;
  description: string;
  timestamp: string;
  gitBranch?: string;
  gitCommitHash?: string;
  tags?: string[];
  isFavorite?: boolean;
  fileCount?: number;
  files?: unknown[];
}

/** Formatted snapshot for display */
interface FormattedSnapshot {
  id: string;
  description: string;
  timestamp: string;
  gitBranch?: string;
  gitCommitHash?: string;
  tags: string[];
  isFavorite: boolean;
  fileCount: number;
}

/** Options for filter list commands (favorites, byTags, byDate, byFile) */
interface FilterListOptions extends BaseCommandOptions, PaginationOptions {}

export interface FilterOptions {
  tags?: string[];
  favorites?: boolean;
  dateRange?: {
    from?: string;
    to?: string;
  };
  files?: string[];
  gitBranch?: string;
  searchText?: string;
  limit?: number;
  offset?: number;
}

export class FilterCommands {
  constructor(private client: UnifiedClient) {}

  private parseDate(dateString: string): string {
    // Handle relative dates like "1h", "2d", "1w", "3m"
    const now = new Date();
    const match = dateString.match(/^(\d+)([hdwmy])$/);

    if (match) {
      const amount = parseInt(match[1]);
      const unit = match[2];

      switch (unit) {
        case 'h': // hours
          now.setHours(now.getHours() - amount);
          break;
        case 'd': // days
          now.setDate(now.getDate() - amount);
          break;
        case 'w': // weeks
          now.setDate(now.getDate() - amount * 7);
          break;
        case 'm': // months
          now.setMonth(now.getMonth() - amount);
          break;
        case 'y': // years
          now.setFullYear(now.getFullYear() - amount);
          break;
      }

      return now.toISOString();
    }

    // Try to parse as ISO date
    return new Date(dateString).toISOString();
  }

  private formatSnapshot(snapshot: SnapshotRecord): FormattedSnapshot {
    return {
      id: snapshot.id,
      description: snapshot.description,
      timestamp: snapshot.timestamp,
      gitBranch: snapshot.gitBranch,
      gitCommitHash: snapshot.gitCommitHash?.substring(0, 8),
      tags: snapshot.tags || [],
      isFavorite: !!snapshot.isFavorite,
      fileCount: snapshot.fileCount || snapshot.files?.length || 0,
    };
  }

  async favorites(options: FilterListOptions): Promise<void> {
    const filterOpts: FilterOptions = {
      favorites: true,
      limit: parseInt(String(options.limit)) || undefined,
      offset: parseInt(String(options.offset)) || 0,
    };

    try {
      const result = await this.client.callApi('filterSnapshots', filterOpts);

      if (options.json) {
        printResult(
          {
            success: true,
            snapshots: result.snapshots || [],
            totalCount: result.totalCount || 0,
            filteredCount: result.snapshots?.length || 0,
          },
          options,
        );
      } else {
        const snapshots = result.snapshots || [];

        if (snapshots.length === 0) {
          console.log(chalk.yellow('No favorite snapshots found'));
          return;
        }

        console.log(chalk.blue(`Favorite Snapshots (${snapshots.length}):`));
        console.log('');

        snapshots.forEach((snapshot: SnapshotRecord) => {
          const formatted = this.formatSnapshot(snapshot);
          console.log(`${chalk.yellow('★')} ${chalk.cyan(formatted.id)}`);
          console.log(`    ${formatted.description}`);
          console.log(
            `    ${chalk.gray(new Date(formatted.timestamp).toLocaleString())}`,
          );
          if (formatted.tags.length > 0) {
            console.log(
              `    ${formatted.tags
                .map((tag: string) => chalk.blue(`#${tag}`))
                .join(' ')}`,
            );
          }
          if (formatted.gitBranch) {
            console.log(
              `    ${chalk.green(formatted.gitBranch)} ${chalk.gray(
                formatted.gitCommitHash,
              )}`,
            );
          }
          console.log('');
        });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (options.json) {
        printResult({ success: false, error: errorMessage }, options);
      } else {
        setFailure();
        console.error(
          chalk.red('✗ Failed to get favorite snapshots:'),
          errorMessage,
        );
      }
    }
  }

  async byTags(tags: string, options: FilterListOptions): Promise<void> {
    const tagList = tags.split(',').map((t) => t.trim());
    const filterOpts: FilterOptions = {
      tags: tagList,
      limit: parseInt(String(options.limit)) || undefined,
      offset: parseInt(String(options.offset)) || 0,
    };

    try {
      const result = await this.client.callApi('filterSnapshots', filterOpts);

      if (options.json) {
        printResult(
          {
            success: true,
            filterTags: tagList,
            snapshots: result.snapshots || [],
            totalCount: result.totalCount || 0,
            filteredCount: result.snapshots?.length || 0,
          },
          options,
        );
      } else {
        const snapshots = result.snapshots || [];

        if (snapshots.length === 0) {
          console.log(
            chalk.yellow(
              `No snapshots found with tags: ${tagList
                .map((t) => `#${t}`)
                .join(', ')}`,
            ),
          );
          return;
        }

        console.log(
          chalk.blue(
            `Snapshots with tags ${tagList
              .map((t) => chalk.blue(`#${t}`))
              .join(', ')} (${snapshots.length}):`,
          ),
        );
        console.log('');

        snapshots.forEach((snapshot: SnapshotRecord) => {
          const formatted = this.formatSnapshot(snapshot);
          const icon = formatted.isFavorite ? chalk.yellow('★ ') : '  ';
          console.log(`${icon}${chalk.cyan(formatted.id)}`);
          console.log(`    ${formatted.description}`);
          console.log(
            `    ${chalk.gray(new Date(formatted.timestamp).toLocaleString())}`,
          );
          console.log(
            `    ${formatted.tags
              .map((tag: string) => chalk.blue(`#${tag}`))
              .join(' ')}`,
          );
          console.log('');
        });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (options.json) {
        printResult({ success: false, error: errorMessage }, options);
      } else {
        setFailure();
        console.error(
          chalk.red('✗ Failed to filter snapshots by tags:'),
          errorMessage,
        );
      }
    }
  }

  async byDate(dateRange: string, options: FilterListOptions): Promise<void> {
    let fromDate: string | undefined;
    let toDate: string | undefined;

    if (dateRange.includes('..')) {
      const [from, to] = dateRange.split('..');
      fromDate = from ? this.parseDate(from) : undefined;
      toDate = to ? this.parseDate(to) : undefined;
    } else {
      // Single date means "since this date"
      fromDate = this.parseDate(dateRange);
    }

    const filterOpts: FilterOptions = {
      dateRange: { from: fromDate, to: toDate },
      limit: parseInt(String(options.limit)) || undefined,
      offset: parseInt(String(options.offset)) || 0,
    };

    try {
      const result = await this.client.callApi('filterSnapshots', filterOpts);

      if (options.json) {
        printResult(
          {
            success: true,
            dateRange: { from: fromDate, to: toDate },
            snapshots: result.snapshots || [],
            totalCount: result.totalCount || 0,
            filteredCount: result.snapshots?.length || 0,
          },
          options,
        );
      } else {
        const snapshots = result.snapshots || [];

        if (snapshots.length === 0) {
          console.log(
            chalk.yellow(`No snapshots found in date range: ${dateRange}`),
          );
          return;
        }

        const rangeText = toDate
          ? `${new Date(fromDate || '').toLocaleDateString()} - ${new Date(
              toDate,
            ).toLocaleDateString()}`
          : `since ${new Date(fromDate || '').toLocaleDateString()}`;

        console.log(
          chalk.blue(`Snapshots ${rangeText} (${snapshots.length}):`),
        );
        console.log('');

        snapshots.forEach((snapshot: SnapshotRecord) => {
          const formatted = this.formatSnapshot(snapshot);
          const icon = formatted.isFavorite ? chalk.yellow('★ ') : '  ';
          console.log(`${icon}${chalk.cyan(formatted.id)}`);
          console.log(`    ${formatted.description}`);
          console.log(
            `    ${chalk.gray(new Date(formatted.timestamp).toLocaleString())}`,
          );
          if (formatted.tags.length > 0) {
            console.log(
              `    ${formatted.tags
                .map((tag: string) => chalk.blue(`#${tag}`))
                .join(' ')}`,
            );
          }
          console.log('');
        });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (options.json) {
        printResult({ success: false, error: errorMessage }, options);
      } else {
        setFailure();
        console.error(
          chalk.red('✗ Failed to filter snapshots by date:'),
          errorMessage,
        );
      }
    }
  }

  async byFile(filePath: string, options: FilterListOptions): Promise<void> {
    const filterOpts: FilterOptions = {
      files: [filePath],
      limit: parseInt(String(options.limit)) || undefined,
      offset: parseInt(String(options.offset)) || 0,
    };

    try {
      const result = await this.client.callApi('filterSnapshots', filterOpts);

      if (options.json) {
        printResult(
          {
            success: true,
            filePath,
            snapshots: result.snapshots || [],
            totalCount: result.totalCount || 0,
            filteredCount: result.snapshots?.length || 0,
          },
          options,
        );
      } else {
        const snapshots = result.snapshots || [];

        if (snapshots.length === 0) {
          console.log(
            chalk.yellow(`No snapshots found containing file: ${filePath}`),
          );
          return;
        }

        console.log(
          chalk.blue(
            `Snapshots containing ${chalk.yellow(filePath)} (${
              snapshots.length
            }):`,
          ),
        );
        console.log('');

        snapshots.forEach((snapshot: SnapshotRecord) => {
          const formatted = this.formatSnapshot(snapshot);
          const icon = formatted.isFavorite ? chalk.yellow('★ ') : '  ';
          console.log(`${icon}${chalk.cyan(formatted.id)}`);
          console.log(`    ${formatted.description}`);
          console.log(
            `    ${chalk.gray(new Date(formatted.timestamp).toLocaleString())}`,
          );
          if (formatted.tags.length > 0) {
            console.log(
              `    ${formatted.tags
                .map((tag: string) => chalk.blue(`#${tag}`))
                .join(' ')}`,
            );
          }
          console.log('');
        });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (options.json) {
        printResult({ success: false, error: errorMessage }, options);
      } else {
        setFailure();
        console.error(
          chalk.red('✗ Failed to filter snapshots by file:'),
          errorMessage,
        );
      }
    }
  }

  async toggleFavorite(
    snapshotId: string,
    options: BaseCommandOptions,
  ): Promise<void> {
    try {
      const result = await this.client.callApi('toggleFavoriteStatus', {
        snapshotId,
      });

      if (options.json) {
        printResult(
          {
            success: true,
            snapshotId,
            isFavorite: result.isFavorite,
            message: `Snapshot ${
              result.isFavorite ? 'added to' : 'removed from'
            } favorites`,
          },
          options,
        );
      } else {
        const status = result.isFavorite
          ? chalk.yellow('★ added to favorites')
          : 'removed from favorites';
        console.log(chalk.green(`✓ Snapshot ${status}`));
        console.log(`Snapshot: ${chalk.cyan(snapshotId)}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (options.json) {
        printResult({ success: false, error: errorMessage }, options);
      } else {
        setFailure();
        console.error(
          chalk.red('✗ Failed to toggle favorite status:'),
          errorMessage,
        );
      }
    }
  }

  async editTags(
    snapshotId: string,
    tags: string,
    options: BaseCommandOptions,
  ): Promise<void> {
    const tagList = tags ? tags.split(',').map((t) => t.trim()) : [];

    try {
      const result = await this.client.callApi('editSnapshotTags', {
        snapshotId,
        tags: tagList,
      });

      if (options.json) {
        printResult(
          {
            success: true,
            snapshotId,
            tags: result.tags || [],
            message: 'Snapshot tags updated successfully',
          },
          options,
        );
      } else {
        console.log(chalk.green('✓ Snapshot tags updated successfully'));
        console.log(`Snapshot: ${chalk.cyan(snapshotId)}`);
        console.log(
          `Tags: ${
            (result.tags || [])
              .map((tag: string) => chalk.blue(`#${tag}`))
              .join(' ') || chalk.gray('(no tags)')
          }`,
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (options.json) {
        printResult({ success: false, error: errorMessage }, options);
      } else {
        setFailure();
        console.error(
          chalk.red('✗ Failed to edit snapshot tags:'),
          errorMessage,
        );
      }
    }
  }

  async editNotes(
    snapshotId: string,
    notes: string,
    options: BaseCommandOptions,
  ): Promise<void> {
    try {
      const result = await this.client.callApi('editSnapshotNotes', {
        snapshotId,
        notes,
      });

      if (options.json) {
        printResult(
          {
            success: true,
            snapshotId,
            notes: result.notes || '',
            message: 'Snapshot notes updated successfully',
          },
          options,
        );
      } else {
        console.log(chalk.green('✓ Snapshot notes updated successfully'));
        console.log(`Snapshot: ${chalk.cyan(snapshotId)}`);
        console.log(`Notes: ${result.notes || chalk.gray('(no notes)')}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (options.json) {
        printResult({ success: false, error: errorMessage }, options);
      } else {
        setFailure();
        console.error(
          chalk.red('✗ Failed to edit snapshot notes:'),
          errorMessage,
        );
      }
    }
  }

  async editTaskRef(
    snapshotId: string,
    taskRef: string,
    options: BaseCommandOptions,
  ): Promise<void> {
    try {
      const result = await this.client.callApi('editTaskReference', {
        snapshotId,
        taskReference: taskRef,
      });

      if (options.json) {
        printResult(
          {
            success: true,
            snapshotId,
            taskReference: result.taskReference || '',
            message: 'Snapshot task reference updated successfully',
          },
          options,
        );
      } else {
        console.log(
          chalk.green('✓ Snapshot task reference updated successfully'),
        );
        console.log(`Snapshot: ${chalk.cyan(snapshotId)}`);
        console.log(
          `Task Reference: ${
            result.taskReference || chalk.gray('(no task reference)')
          }`,
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (options.json) {
        printResult({ success: false, error: errorMessage }, options);
      } else {
        setFailure();
        console.error(
          chalk.red('✗ Failed to edit task reference:'),
          errorMessage,
        );
      }
    }
  }
}
