import * as vscode from 'vscode';
import { SnapshotTreeDataProvider } from './treeView';
import { log } from '../logger';

/**
 * Displays the number of active filters in the status bar for a snapshot view.
 */
export class FilterStatusBar implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private treeDataProvider: SnapshotTreeDataProvider;
  private viewName: string;
  /** Retained so it can be released; the return value was previously dropped. */
  private treeDataSubscription: vscode.Disposable;

  /**
   * @param treeDataProvider The provider to observe for filter changes
   * @param viewName Label of the view (e.g., 'Manual' or 'Auto')
   */
  constructor(treeDataProvider: SnapshotTreeDataProvider, viewName: string) {
    this.treeDataProvider = treeDataProvider;
    this.viewName = viewName;
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );

    // Watch for filter changes
    this.treeDataSubscription = treeDataProvider.onDidChangeTreeData(() => {
      this.update();
    });

    // Set initial state
    this.update();

    this.statusBarItem.show();
    log(`Filter status bar initialized for ${viewName} view`);
  }

  /**
   * Update the status bar based on current filter count.
   */
  private update(): void {
    const filterCount = this.treeDataProvider.getActiveFilterCount();

    if (filterCount === 0) {
      this.statusBarItem.hide();
      return;
    }

    this.statusBarItem.text = `$(filter) ${this.viewName}: ${filterCount} filters`;
    this.statusBarItem.tooltip = `${
      this.viewName
    } View: ${this.treeDataProvider.getActiveFiltersDescription()}
Click to clear all filters`;
    this.statusBarItem.command = 'vscode-snapshots.clearAllFilters';
    this.statusBarItem.show();
  }

  /**
   * Dispose of the status bar item and its subscription when no longer needed.
   */
  dispose(): void {
    this.treeDataSubscription.dispose();
    this.statusBarItem.dispose();
  }
}
