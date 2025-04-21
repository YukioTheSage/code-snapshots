import * as vscode from 'vscode';
import { log } from './logger';

/**
 * Activate the simple CodeLapse extension.
 * @param context Extension context for subscriptions.
 */
export function activate(context: vscode.ExtensionContext) {
  log('CodeLapse simple extension is now active');

  // Register commands with inline handlers for simplicity
  const takeSnapshotCmd = vscode.commands.registerCommand(
    'vscode-snapshots.takeSnapshot',
    () => {
      vscode.window.showInformationMessage('Snapshot taken!');
    },
  );

  const viewSnapshotsCmd = vscode.commands.registerCommand(
    'vscode-snapshots.viewSnapshots',
    () => {
      vscode.window.showInformationMessage('View snapshots!');
    },
  );

  const previousSnapshotCmd = vscode.commands.registerCommand(
    'vscode-snapshots.previousSnapshot',
    () => {
      vscode.window.showInformationMessage('Previous snapshot!');
    },
  );

  const nextSnapshotCmd = vscode.commands.registerCommand(
    'vscode-snapshots.nextSnapshot',
    () => {
      vscode.window.showInformationMessage('Next snapshot!');
    },
  );

  // Add to subscriptions
  context.subscriptions.push(takeSnapshotCmd);
  context.subscriptions.push(viewSnapshotsCmd);
  context.subscriptions.push(previousSnapshotCmd);
  context.subscriptions.push(nextSnapshotCmd);

  // Status bar
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  statusBarItem.text = '$(history) CodeLapse';
  statusBarItem.tooltip = 'CodeLapse extension is active';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  vscode.window.showInformationMessage('CodeLapse extension is ready!');
}

/**
 * Deactivate the extension and clean up resources.
 */
export function deactivate() {
  // No resources to dispose in simple extension
}
