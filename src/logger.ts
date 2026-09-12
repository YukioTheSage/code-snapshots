import * as vscode from 'vscode';
import { isInteractiveUiDisabled } from './headless';

let outputChannel: vscode.OutputChannel | undefined;
let loggingEnabled = true;
let verboseLogging = false;

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  data?: Record<string, unknown>;
}

const MAX_LOG_ENTRIES = 1000;
const logEntries: LogEntry[] = [];
const logListeners = new Set<(entry: LogEntry) => void>();

function recordLog(
  level: string,
  message: string,
  args: unknown[],
): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(args.length > 0
      ? {
          data: {
            args: args.map((arg) =>
              typeof arg === 'string' ||
              typeof arg === 'number' ||
              typeof arg === 'boolean' ||
              arg === null
                ? arg
                : String(arg),
            ),
          },
        }
      : {}),
  };

  logEntries.push(entry);
  if (logEntries.length > MAX_LOG_ENTRIES) {
    logEntries.splice(0, logEntries.length - MAX_LOG_ENTRIES);
  }

  for (const listener of logListeners) {
    try {
      listener(entry);
    } catch {
      // A diagnostics listener must never break the logging path.
    }
  }
}

/**
 * Subscribe to new log entries. Returns an unsubscribe function.
 */
export function subscribeToLogEntries(
  listener: (entry: LogEntry) => void,
): () => void {
  logListeners.add(listener);
  return () => {
    logListeners.delete(listener);
  };
}

/**
 * Recent log entries, newest last, filtered and truncated for diagnostics.
 */
export function getLogEntries(options?: {
  lines?: number;
  level?: string;
  since?: string;
}): { logs: LogEntry[]; totalEntries: number } {
  let entries = [...logEntries];

  if (options?.level && options.level !== 'all') {
    entries = entries.filter((entry) => entry.level === options.level);
  }

  if (options?.since) {
    const threshold = Date.parse(options.since);
    if (!Number.isNaN(threshold)) {
      entries = entries.filter(
        (entry) => Date.parse(entry.timestamp) >= threshold,
      );
    }
  }

  const totalEntries = entries.length;
  const lines = options?.lines ?? 100;
  return {
    logs: lines > 0 ? entries.slice(-lines) : entries,
    totalEntries,
  };
}

/**
 * Clear buffered log entries, optionally only entries older than a date or at
 * a specific level.
 */
export function clearLogEntries(options?: {
  olderThan?: string;
  level?: string;
}): number {
  const threshold = options?.olderThan
    ? Date.parse(options.olderThan)
    : Number.NaN;
  const before = logEntries.length;

  for (let index = logEntries.length - 1; index >= 0; index--) {
    const entry = logEntries[index];
    if (options?.level && options.level !== 'all' && entry.level !== options.level) {
      continue;
    }
    if (!Number.isNaN(threshold) && Date.parse(entry.timestamp) >= threshold) {
      continue;
    }
    logEntries.splice(index, 1);
  }

  return before - logEntries.length;
}

export function initializeLogger(context: vscode.ExtensionContext) {
  // Create output channel if it doesn't exist
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('CodeLapse');
    context.subscriptions.push(outputChannel); // Ensure it's disposed with the extension
  }

  // Load initial config
  updateLoggingConfig();

  // Watch for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration('vscode-snapshots.loggingEnabled') ||
        e.affectsConfiguration('vscode-snapshots.verboseLogging')
      ) {
        updateLoggingConfig();
        log('Logging configuration updated.');
      }
    }),
  );

  log('Logger initialized.');
}

function updateLoggingConfig() {
  const config = vscode.workspace.getConfiguration('vscode-snapshots');
  loggingEnabled = config.get<boolean>('loggingEnabled', true);
  verboseLogging = config.get<boolean>('verboseLogging', false);
}

export function log(message: string, ...args: unknown[]): void {
  recordLog('info', message, args);
  if (loggingEnabled && process.env.NODE_ENV !== 'test') {
    const logMessage = `[CodeLapse] ${message}`;
    console.log(logMessage, ...args);
    if (outputChannel) {
      outputChannel.appendLine(
        logMessage + (args.length > 0 ? ' ' + args.join(' ') : ''),
      );
    }
  }
}

export function logVerbose(message: string, ...args: unknown[]): void {
  if (loggingEnabled && verboseLogging && process.env.NODE_ENV !== 'test') {
    log(`[VERBOSE] ${message}`, ...args);
  }
}

export function getOutputChannel(): vscode.OutputChannel | undefined {
  return outputChannel;
}

export function showOutputChannel(): void {
  // Revealing the panel is a UI side effect, and this is the single choke point
  // for it. In a headless run there is nobody to read it, while the output
  // editor it opens cannot be closed again by any API this host offers
  // (`workbench.action.closeAllEditors`, `workbench.action.closeActiveEditor`
  // and `window.tabGroups.close` all leave it in the workbench). It then
  // lingers for the rest of the run and the assertion "no editor is open" in a
  // later suite depends on focus bookkeeping instead of on the extension
  // leaving the host as it found it. The log lines themselves are still
  // written; only the reveal is skipped.
  if (isInteractiveUiDisabled()) {
    // Announce the skip like every other headless guard does, so "I asked for
    // the logs and nothing happened" is attributable from the captured output.
    log(
      'Interactive UI disabled (headless run); skipping the output channel reveal.',
    );
    return;
  }
  if (outputChannel) {
    outputChannel.show();
  }
}
