import * as vscode from 'vscode';
import { SnapshotTreeDataProvider } from './treeView';
import { log } from '../logger';

/**
 * Displays the number of active filters in the status bar for a snapshot view.
 */
export class FilterStatusBar {
  private statusBarItem: vscode.StatusBarItem;
  private treeDataProvider: SnapshotTreeDataProvider;
  private viewName: string;

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

    // Set initial state
    this.update();

    // Watch for filter changes
    treeDataProvider.onDidChangeTreeData(() => {
      this.update();
    });

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
   * Dispose of the status bar item when no longer needed.
   */
  dispose(): void {
    this.statusBarItem.dispose();
  }
}
