import * as vscode from 'vscode';
import { SnapshotManager } from './snapshotManager'; // Assuming SnapshotManager is accessible
import { log } from './logger';

export class SnapshotContentProvider
  implements vscode.TextDocumentContentProvider
{
  // Keep a reference to the SnapshotManager instance
  private snapshotManager: SnapshotManager;

  constructor(manager: SnapshotManager) {
    this.snapshotManager = manager;
  }

  // Event emitter for content changes (optional but good practice)
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  /**
   * Provides the content for a snapshot file URI.
   * The URI format is expected to be: snapshot-diff://<snapshotId>/<relativePath>?nonce=<random>
   * @param uri The virtual document URI.
   * @returns The file content as a string, or an empty string if not found/error.
   */
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    log(
      `SnapshotContentProvider: Providing content for URI: ${uri.toString()}`,
    );

    const snapshotId = uri.authority; // <snapshotId>
    // Need to handle potential leading '/' in path if authority is empty
    const relativePath = uri.path.startsWith('/')
      ? uri.path.substring(1)
      : uri.path; // <relativePath>

    if (!snapshotId || !relativePath) {
      log(
        `Error: Invalid URI format for SnapshotContentProvider: ${uri.toString()}`,
      );
      vscode.window.showErrorMessage(`Invalid snapshot URI: ${uri.toString()}`);
      return ''; // Return empty content for invalid URIs
    }

    log(
      `SnapshotContentProvider: Requesting content for snapshotId=${snapshotId}, relativePath=${relativePath}`,
    );

    try {
      // Check if the query parameter 'forIndexing' is present
      const queryParams = new URLSearchParams(uri.query);
      const forIndexing = queryParams.has('forIndexing');

      // Use the public method from SnapshotManager to get the file content
      const content = await this.snapshotManager.getSnapshotFileContentPublic(
        snapshotId,
        relativePath,
        forIndexing, // Pass the forIndexing flag
      );

      if (content === null) {
        log(
          `Warning: Content for ${relativePath} in snapshot ${snapshotId} is null (possibly deleted or error).`,
        );
        // Return empty string for null content, diff view will show it as empty
        return '';
      }

      log(
        `SnapshotContentProvider: Content retrieved successfully for ${relativePath}`,
      );
      return content;
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      log(`Error retrieving snapshot content for ${uri.toString()}: ${errMsg}`);
      vscode.window.showErrorMessage(
        `Failed to load snapshot content for ${relativePath}: ${errMsg}`,
      );
      return ''; // Return empty content on error
    }
  }

  /**
   * Utility method to create a URI for the content provider.
   * Includes a nonce to ensure VS Code treats it as unique content each time.
   * @param snapshotId The snapshot ID
   * @param relativePath The relative path within the snapshot
   * @param forIndexing If true, indicates this URI is for indexing purposes and shouldn't be
   * displayed in the editor tabs
   */
  static getUri(
    snapshotId: string,
    relativePath: string,
    forIndexing = false,
  ): vscode.Uri {
    const nonce = Date.now(); // Simple nonce
    // Ensure the path doesn't start with / after authority
    const pathPart = relativePath.startsWith('/')
      ? relativePath
      : `/${relativePath}`;

    // Add forIndexing parameter to URI query if needed
    const queryParams = `nonce=${nonce}${
      forIndexing ? '&forIndexing=true' : ''
    }`;

    return vscode.Uri.parse(
      `snapshot-diff://${snapshotId}${pathPart}?${queryParams}`,
    );
  }
}
