import * as vscode from 'vscode';

/**
 * Service for workspace-related utilities
 */
export class WorkspaceService {
  /**
   * Gets the root path of the first workspace folder
   * @returns The file system path of the first workspace folder, or undefined if no folders are open
   */
  public getWorkspaceRoot(): string | undefined {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return undefined;
    }
    return workspaceFolders[0].uri.fsPath;
  }
}
