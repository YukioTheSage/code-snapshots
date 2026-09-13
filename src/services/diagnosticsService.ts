import { ConfigManager, GitIntegration } from 'codelapse-core';
import type { Snapshot } from '../snapshotManager';
import type { SnapshotIntegrityReport } from '../snapshotVerification';
import { getSnapshotLocation } from '../config';
import { clearLogEntries, getLogEntries } from '../logger';

export interface DiagnosticsCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DiagnosticsReport {
  generatedAt: string;
  healthy: boolean;
  checks: DiagnosticsCheck[];
  integrity: SnapshotIntegrityReport;
  store: { snapshotCount: number; totalBytes: number };
  config: { valid: boolean; errors: string[] };
  git: { available: boolean; branch?: string };
  version: string;
}

export interface DiagnosticsRunResult extends DiagnosticsReport {
  diagnostics: Array<{
    category: string;
    level: 'info' | 'warning' | 'error';
    message: string;
    details?: Record<string, unknown>;
    timestamp: string;
  }>;
  systemInfo: SystemInfo;
  summary: { info: number; warnings: number; errors: number };
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

interface DiagnosticsSnapshotManager {
  getSnapshots(): Snapshot[];
  getIntegrityReport(): SnapshotIntegrityReport;
  getWorkspaceRoot(): string | null;
  getStorageStats?(): Promise<{
    snapshotCount: number;
    totalSize: number;
  }>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Diagnostics are read-only observations. A failing check must be reported,
 * never thrown: a diagnostics command that dies on the condition it is meant to
 * describe is useless.
 */
export class DiagnosticsService {
  constructor(
    private readonly snapshotManager: DiagnosticsSnapshotManager,
    private readonly workspaceRoot: string,
    private readonly extensionVersion = process.env.npm_package_version ||
      '0.0.0',
  ) {}

  private estimateStoreBytes(snapshots: Snapshot[]): number {
    return Buffer.byteLength(JSON.stringify(snapshots), 'utf8');
  }

  private async tryGetStorageStats(): Promise<{
    snapshotCount: number;
    totalSize: number;
  } | null> {
    const getStorageStats = this.snapshotManager.getStorageStats;
    if (typeof getStorageStats !== 'function') {
      return null;
    }

    try {
      const stats = await getStorageStats.call(this.snapshotManager);
      if (
        stats &&
        typeof stats.snapshotCount === 'number' &&
        typeof stats.totalSize === 'number'
      ) {
        return stats;
      }
    } catch {
      // The report still has the snapshot-list estimate; a store-stat failure
      // must not take the whole diagnostics command down.
    }
    return null;
  }

  private getGitInfo(): { available: boolean; branch?: string } {
    try {
      const git = new GitIntegration(this.workspaceRoot);
      const available = git.isGitRepository();
      return {
        available,
        ...(available && git.getCurrentBranch()
          ? { branch: git.getCurrentBranch() }
          : {}),
      };
    } catch {
      return { available: false };
    }
  }

  private async buildReport(): Promise<DiagnosticsReport> {
    const snapshots = this.snapshotManager.getSnapshots();
    const integrity = this.snapshotManager.getIntegrityReport();
    const storageStats = await this.tryGetStorageStats();
    const store = {
      snapshotCount: storageStats?.snapshotCount ?? snapshots.length,
      totalBytes: storageStats?.totalSize ?? this.estimateStoreBytes(snapshots),
    };

    const config = new ConfigManager(this.workspaceRoot).validate();
    const git = this.getGitInfo();
    const workspaceOpen = Boolean(this.workspaceRoot);

    const checks: DiagnosticsCheck[] = [
      {
        name: 'snapshot-integrity',
        ok: integrity.unrecoverableFileCount === 0,
        detail:
          integrity.unrecoverableFileCount === 0
            ? 'all snapshot content is reconstructable'
            : `${integrity.unrecoverableFileCount} file(s) across ${
                integrity.brokenSnapshotIds.length
              } snapshot(s) cannot be reconstructed; missing base(s): ${
                integrity.missingBaseSnapshotIds.join(', ') || 'none'
              }`,
      },
      {
        name: 'snapshot-store',
        ok: true,
        detail: `${store.snapshotCount} snapshot(s), ${store.totalBytes} bytes`,
      },
      {
        name: 'config',
        ok: config.valid,
        detail: config.valid
          ? 'configuration is valid'
          : config.errors.join('; '),
      },
      {
        name: 'git',
        ok: true,
        detail: git.available
          ? `repository on branch ${git.branch ?? '(detached)'}`
          : 'not a git repository (informational)',
      },
      {
        name: 'workspace',
        ok: workspaceOpen,
        detail: workspaceOpen ? this.workspaceRoot : 'no workspace folder open',
      },
    ];

    return {
      generatedAt: new Date().toISOString(),
      healthy: checks.every((check) => check.ok),
      checks,
      integrity,
      store,
      config,
      git,
      version: this.extensionVersion,
    };
  }

  public getSystemInfo(): SystemInfo {
    const snapshots = this.snapshotManager.getSnapshots();
    const totalBytes = this.estimateStoreBytes(snapshots);
    const git = this.getGitInfo();

    return {
      version: this.extensionVersion,
      extensionVersion: this.extensionVersion,
      workspace: this.workspaceRoot || null,
      snapshotLocation: getSnapshotLocation(),
      totalSnapshots: snapshots.length,
      diskUsage: formatBytes(totalBytes),
      gitRepository: git.available,
      ...(git.branch ? { gitBranch: git.branch } : {}),
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
    };
  }

  public async runDiagnostics(): Promise<DiagnosticsRunResult> {
    const report = await this.buildReport();
    const diagnostics = report.checks.map((check) => ({
      category: check.name,
      level: (check.ok ? 'info' : 'error') as 'info' | 'error',
      message: check.detail,
      details: { ok: check.ok },
      timestamp: report.generatedAt,
    }));

    return {
      ...report,
      diagnostics,
      systemInfo: this.getSystemInfo(),
      summary: {
        info: report.checks.filter((check) => check.ok).length,
        warnings: 0,
        errors: report.checks.filter((check) => !check.ok).length,
      },
    };
  }

  public async healthCheck(): Promise<{
    healthy: boolean;
    checks: DiagnosticsCheck[];
    score: number;
    issues: Array<{ message: string; suggestion?: string }>;
    health: Record<
      string,
      { healthy: boolean; message: string; details?: Record<string, unknown> }
    >;
  }> {
    const report = await this.buildReport();
    const errors = report.checks.filter((check) => !check.ok);
    const score = Math.max(0, 100 - errors.length * 25);
    const issues = errors.map((check) => ({
      message: check.detail,
      suggestion:
        check.name === 'snapshot-integrity'
          ? 'Restore from an older complete snapshot or re-index the workspace.'
          : undefined,
    }));
    const health: Record<
      string,
      { healthy: boolean; message: string; details?: Record<string, unknown> }
    > = {};
    for (const check of report.checks) {
      health[check.name] = { healthy: check.ok, message: check.detail };
    }

    return {
      healthy: report.healthy,
      checks: report.checks,
      score,
      issues,
      health,
    };
  }

  public getLogs(options?: {
    lines?: number;
    level?: string;
    since?: string;
  }): { logs: ReturnType<typeof getLogEntries>['logs']; totalEntries: number } {
    return getLogEntries(options);
  }

  public clearLogs(options?: { olderThan?: string; level?: string }): {
    clearedEntries: number;
  } {
    return { clearedEntries: clearLogEntries(options) };
  }

  public async getPerformanceMetrics(): Promise<{
    metrics: {
      avgSnapshotTime: number;
      avgSearchTime: number;
      memoryUsage: number;
      cpuUsage: number;
      activeOperations: number;
    };
    history: Array<{
      timestamp: string;
      snapshotTime: number;
      searchTime: number;
    }>;
  }> {
    return {
      metrics: {
        avgSnapshotTime: 0,
        avgSearchTime: 0,
        memoryUsage: Math.round(process.memoryUsage().heapUsed / (1024 * 1024)),
        cpuUsage: 0,
        activeOperations: 0,
      },
      history: [],
    };
  }
}
