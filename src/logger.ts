import * as vscode from 'vscode';

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
  if (outputChannel) {
    outputChannel.show();
  }
}
