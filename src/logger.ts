import * as vscode from 'vscode';
import { isInteractiveUiDisabled } from './headless';

let outputChannel: vscode.OutputChannel | undefined;
let loggingEnabled = true;
let verboseLogging = false;

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
    return;
  }
  if (outputChannel) {
    outputChannel.show();
  }
}
