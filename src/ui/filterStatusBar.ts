import * as vscode from 'vscode';
import { SnapshotTreeDataProvider } from './treeView';
import { log } from '../logger';

export class FilterStatusBar {
  private statusBarItem: vscode.StatusBarItem;
  private treeDataProvider: SnapshotTreeDataProvider;
  private viewName: string; // Add view name for display

  constructor(treeDataProvider: SnapshotTreeDataProvider, viewName: string) {
    this.treeDataProvider = treeDataProvider;
    this.viewName = viewName;
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );

    // Set initial state
    this.update();

    // Watch for filter changes
    treeDataProvider.onDidChangeTreeData(() => {
      this.update();
    });

    this.statusBarItem.show();
    log(`Filter status bar initialized for ${viewName} view`);
  }

  private update(): void {
    const filterCount = this.treeDataProvider.getActiveFilterCount();

    if (filterCount === 0) {
      this.statusBarItem.hide();
      return;
    }

    this.statusBarItem.text = `$(filter) ${this.viewName}: ${filterCount} filters`;
    this.statusBarItem.tooltip = `${
      this.viewName
    } View: ${this.treeDataProvider.getActiveFiltersDescription()}\nClick to clear all filters`;
    this.statusBarItem.command = 'vscode-snapshots.clearAllFilters';
    this.statusBarItem.show();
  }

  dispose(): void {
    this.statusBarItem.dispose();
  }
}
