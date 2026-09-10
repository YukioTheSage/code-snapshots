import chalk from 'chalk';
import { UnifiedClient } from '../unifiedClient';

export interface DiagnosticResult {
  category: string;
  level: 'info' | 'warning' | 'error';
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface SystemInfo {
  version: string;
  workspace: string | null;
  snapshotLocation: string;
  totalSnapshots: number;
  diskUsage: string;
  gitRepository: boolean;
  gitBranch?: string;
  extensionVersion: string;
  nodeVersion: string;
  platform: string;
  architecture: string;
}

interface DiagnosticsOptions {
  noSystem?: boolean;
  noSnapshots?: boolean;
  noGit?: boolean;
  noConfig?: boolean;
  verbose?: boolean;
  json?: boolean;
  lines?: string;
  level?: string;
  since?: string;
  follow?: boolean;
  olderThan?: string;
  noPerformance?: boolean;
  noConnectivity?: boolean;
  noStorage?: boolean;
  noHistory?: boolean;
  timeRange?: string;
}

interface DiagnosticsSummary {
  info?: number;
  warnings?: number;
  errors?: number;
}

interface HealthStatus {
  healthy: boolean;
  message: string;
  details?: Record<string, unknown>;
}

interface HealthIssue {
  message: string;
  suggestion?: string;
}

interface PerformanceMetrics {
  avgSnapshotTime: number;
  avgSearchTime: number;
  memoryUsage: number;
  cpuUsage: number;
  activeOperations: number;
}

interface PerformanceHistoryEntry {
  timestamp: string;
  snapshotTime: number;
  searchTime: number;
}

interface WatchEvent {
  type: string;
  data: LogEntry;
}

export class DiagnosticsCommands {
  constructor(private client: UnifiedClient) {}

  async run(options: DiagnosticsOptions = {}): Promise<void> {
    try {
      const result = await this.client.callApi('runDiagnostics', {
        includeSystem: !options.noSystem,
        includeSnapshots: !options.noSnapshots,
        includeGit: !options.noGit,
        includeConfiguration: !options.noConfig,
        verbose: !!options.verbose,
      });

      if (options.json) {
        console.log(
          JSON.stringify({
            success: true,
            diagnostics: result.diagnostics || [],
            systemInfo: result.systemInfo || {},
            summary: result.summary || {},
          }),
        );
      } else {
        this.displayDiagnostics(
          result.diagnostics || [],
          result.systemInfo,
          result.summary,
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: errorMessage }));
      } else {
        console.error(chalk.red('✗ Failed to run diagnostics:'), errorMessage);
      }
    }
  }

  async system(options: DiagnosticsOptions = {}): Promise<void> {
    try {
      const result = await this.client.callApi('getSystemInfo', {});

      if (options.json) {
        console.log(
          JSON.stringify({
            success: true,
            systemInfo: result.systemInfo || {},
          }),
        );
      } else {
        this.displaySystemInfo(result.systemInfo);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: errorMessage }));
      } else {
        console.error(
          chalk.red('✗ Failed to get system information:'),
          errorMessage,
        );
      }
    }
  }

  async logs(options: DiagnosticsOptions = {}): Promise<void> {
    const opts = {
      lines: parseInt(options.lines || '100') || 100,
      level: options.level || 'all',
      since: options.since,
      follow: !!options.follow,
    };

    try {
      if (opts.follow) {
        // Streaming logs
        await this.client.callApi('streamLogs', opts);
        // This would set up event listening for log entries
        console.log(chalk.blue('Following logs... (Press Ctrl+C to stop)'));

        this.client.watchEvents(['log'], (event: WatchEvent) => {
          if (event.type === 'log') {
            this.displayLogEntry(event.data, !!options.json);
          }
        });
      } else {
        // Static log retrieval
        const result = await this.client.callApi('getLogs', opts);

        if (options.json) {
          console.log(
            JSON.stringify({
              success: true,
              logs: result.logs || [],
              totalEntries: result.totalEntries || 0,
            }),
          );
        } else {
          const logs = result.logs || [];

          if (logs.length === 0) {
            console.log(chalk.yellow('No logs found'));
            return;
          }

          console.log(chalk.blue(`Logs (${logs.length} entries):`));
          console.log('');

          logs.forEach((entry: LogEntry) => {
            this.displayLogEntry(entry, false);
          });
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: errorMessage }));
      } else {
        console.error(chalk.red('✗ Failed to get logs:'), errorMessage);
      }
    }
  }

  async clearLogs(options: DiagnosticsOptions = {}): Promise<void> {
    const opts = {
      olderThan: options.olderThan,
      level: options.level,
    };

    try {
      const result = await this.client.callApi('clearLogs', opts);

      if (options.json) {
        console.log(
          JSON.stringify({
            success: true,
            clearedEntries: result.clearedEntries || 0,
            message: 'Logs cleared successfully',
          }),
        );
      } else {
        console.log(chalk.green('✓ Logs cleared successfully'));
        console.log(`Cleared entries: ${result.clearedEntries || 0}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: errorMessage }));
      } else {
        console.error(chalk.red('✗ Failed to clear logs:'), errorMessage);
      }
    }
  }

  async health(options: DiagnosticsOptions = {}): Promise<void> {
    try {
      const result = await this.client.callApi('healthCheck', {
        includePerformance: !options.noPerformance,
        includeConnectivity: !options.noConnectivity,
        includeStorage: !options.noStorage,
      });

      if (options.json) {
        console.log(
          JSON.stringify({
            success: true,
            health: result.health || {},
            score: result.score || 0,
            issues: result.issues || [],
          }),
        );
      } else {
        this.displayHealth(result.health, result.score, result.issues);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: errorMessage }));
      } else {
        console.error(chalk.red('✗ Failed to run health check:'), errorMessage);
      }
    }
  }

  async performance(options: DiagnosticsOptions = {}): Promise<void> {
    try {
      const result = await this.client.callApi('getPerformanceMetrics', {
        includeHistory: !options.noHistory,
        timeRange: options.timeRange || '1h',
      });

      if (options.json) {
        console.log(
          JSON.stringify({
            success: true,
            metrics: result.metrics || {},
            history: result.history || [],
          }),
        );
      } else {
        this.displayPerformanceMetrics(result.metrics, result.history);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: errorMessage }));
      } else {
        console.error(
          chalk.red('✗ Failed to get performance metrics:'),
          errorMessage,
        );
      }
    }
  }

  private displayDiagnostics(
    diagnostics: DiagnosticResult[],
    systemInfo: SystemInfo,
    summary: DiagnosticsSummary,
  ): void {
    console.log(chalk.blue('CodeLapse Diagnostics Report'));
    console.log('='.repeat(40));
    console.log('');

    // System Info Summary
    if (systemInfo) {
      console.log(chalk.cyan('System Information:'));
      console.log(`  Extension Version: ${systemInfo.extensionVersion}`);
      console.log(`  Workspace: ${systemInfo.workspace || 'None'}`);
      console.log(`  Total Snapshots: ${systemInfo.totalSnapshots}`);
      console.log(
        `  Git Repository: ${
          systemInfo.gitRepository ? chalk.green('Yes') : chalk.red('No')
        }`,
      );
      console.log('');
    }

    // Group diagnostics by category
    const categories = new Map<string, DiagnosticResult[]>();
    diagnostics.forEach((diagnostic) => {
      if (!categories.has(diagnostic.category)) {
        categories.set(diagnostic.category, []);
      }
      const categoryDiagnostics = categories.get(diagnostic.category);
      if (categoryDiagnostics) {
        categoryDiagnostics.push(diagnostic);
      }
    });

    categories.forEach((results, category) => {
      console.log(chalk.cyan(`${category}:`));

      results.forEach((result) => {
        const icon = this.getDiagnosticIcon(result.level);
        const color = this.getDiagnosticColor(result.level);
        console.log(`  ${icon} ${color(result.message)}`);

        if (result.details) {
          console.log(`    ${chalk.gray(JSON.stringify(result.details))}`);
        }
      });
      console.log('');
    });

    // Summary
    if (summary) {
      console.log(chalk.cyan('Summary:'));
      console.log(`  ${chalk.green('✓')} Info: ${summary.info || 0}`);
      console.log(`  ${chalk.yellow('⚠')} Warnings: ${summary.warnings || 0}`);
      console.log(`  ${chalk.red('✗')} Errors: ${summary.errors || 0}`);
    }
  }

  private displaySystemInfo(systemInfo: SystemInfo): void {
    console.log(chalk.blue('System Information'));
    console.log('='.repeat(30));
    console.log('');

    console.log(`${chalk.cyan('Extension Version:')} ${systemInfo.version}`);
    console.log(
      `${chalk.cyan('Workspace:')} ${systemInfo.workspace || 'None'}`,
    );
    console.log(
      `${chalk.cyan('Snapshot Location:')} ${systemInfo.snapshotLocation}`,
    );
    console.log(
      `${chalk.cyan('Total Snapshots:')} ${systemInfo.totalSnapshots}`,
    );
    console.log(`${chalk.cyan('Disk Usage:')} ${systemInfo.diskUsage}`);
    console.log(
      `${chalk.cyan('Git Repository:')} ${
        systemInfo.gitRepository ? chalk.green('Yes') : chalk.red('No')
      }`,
    );

    if (systemInfo.gitBranch) {
      console.log(`${chalk.cyan('Git Branch:')} ${systemInfo.gitBranch}`);
    }

    console.log(`${chalk.cyan('Node.js Version:')} ${systemInfo.nodeVersion}`);
    console.log(
      `${chalk.cyan('Platform:')} ${systemInfo.platform} ${
        systemInfo.architecture
      }`,
    );
  }

  private displayLogEntry(entry: LogEntry, jsonFormat: boolean): void {
    if (jsonFormat) {
      console.log(JSON.stringify({ type: 'log', entry }));
      return;
    }

    const timestamp = new Date(entry.timestamp).toLocaleString();
    const level = entry.level.toUpperCase();
    const color = this.getLogColor(entry.level);

    console.log(`${chalk.gray(timestamp)} [${color(level)}] ${entry.message}`);

    if (entry.data) {
      console.log(`  ${chalk.gray(JSON.stringify(entry.data))}`);
    }
  }

  private displayHealth(
    health: Record<string, HealthStatus>,
    score: number,
    issues: HealthIssue[],
  ): void {
    console.log(chalk.blue('Health Check Report'));
    console.log('='.repeat(30));
    console.log('');

    const scoreColor =
      score >= 80 ? chalk.green : score >= 60 ? chalk.yellow : chalk.red;
    console.log(
      `${chalk.cyan('Overall Health Score:')} ${scoreColor(score + '/100')}`,
    );
    console.log('');

    // Health categories
    Object.keys(health).forEach((category) => {
      const status = health[category];
      const icon = status.healthy ? chalk.green('✓') : chalk.red('✗');
      console.log(`${icon} ${chalk.cyan(category)}: ${status.message}`);

      if (status.details) {
        Object.keys(status.details).forEach((key) => {
          console.log(`    ${chalk.gray(key)}: ${status.details![key]}`);
        });
      }
    });

    // Issues
    if (issues.length > 0) {
      console.log('');
      console.log(chalk.red('Issues Found:'));
      issues.forEach((issue) => {
        console.log(`  ${chalk.red('•')} ${issue.message}`);
        if (issue.suggestion) {
          console.log(`    ${chalk.blue('Suggestion:')} ${issue.suggestion}`);
        }
      });
    }
  }

  private displayPerformanceMetrics(
    metrics: PerformanceMetrics,
    history: PerformanceHistoryEntry[],
  ): void {
    console.log(chalk.blue('Performance Metrics'));
    console.log('='.repeat(30));
    console.log('');

    console.log(
      `${chalk.cyan('Average Snapshot Time:')} ${metrics.avgSnapshotTime}ms`,
    );
    console.log(
      `${chalk.cyan('Average Search Time:')} ${metrics.avgSearchTime}ms`,
    );
    console.log(`${chalk.cyan('Memory Usage:')} ${metrics.memoryUsage}MB`);
    console.log(`${chalk.cyan('CPU Usage:')} ${metrics.cpuUsage}%`);
    console.log(
      `${chalk.cyan('Active Operations:')} ${metrics.activeOperations}`,
    );

    if (history.length > 0) {
      console.log('');
      console.log(chalk.cyan('Recent Performance History:'));
      history.slice(-10).forEach((entry) => {
        const timestamp = new Date(entry.timestamp).toLocaleTimeString();
        console.log(
          `  ${chalk.gray(timestamp)} - Snapshot: ${
            entry.snapshotTime
          }ms, Search: ${entry.searchTime}ms`,
        );
      });
    }
  }

  private getDiagnosticIcon(level: string): string {
    switch (level) {
      case 'error':
        return chalk.red('✗');
      case 'warning':
        return chalk.yellow('⚠');
      case 'info':
        return chalk.blue('ℹ');
      default:
        return chalk.gray('•');
    }
  }

  private getDiagnosticColor(level: string): (text: string) => string {
    switch (level) {
      case 'error':
        return chalk.red;
      case 'warning':
        return chalk.yellow;
      case 'info':
        return chalk.blue;
      default:
        return chalk.gray;
    }
  }

  private getLogColor(level: string): (text: string) => string {
    switch (level) {
      case 'error':
        return chalk.red;
      case 'warn':
        return chalk.yellow;
      case 'info':
        return chalk.blue;
      case 'debug':
        return chalk.gray;
      default:
        return chalk.white;
    }
  }
}
