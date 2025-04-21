import * as vscode from 'vscode';
import * as diff from 'diff';
import { SnapshotManager } from './snapshotManager';
import { log, logVerbose } from './logger';

export class EditorDecorator implements vscode.Disposable {
  private snapshotManager: SnapshotManager;
  private disposables: vscode.Disposable[] = [];
  private decorationTypes: {
    added: vscode.TextEditorDecorationType;
    modified: vscode.TextEditorDecorationType;
  };
  private timeout: NodeJS.Timeout | undefined = undefined;
  private activeEditor = vscode.window.activeTextEditor;

  constructor(snapshotManager: SnapshotManager) {
    this.snapshotManager = snapshotManager;

    // Define decoration types (customize colors/styles as needed)
    this.decorationTypes = {
      added: vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        gutterIconPath: this.createGutterIcon('rgba(0, 255, 0, 0.7)'), // Greenish
        // overviewRulerColor: 'rgba(0, 255, 0, 0.7)', // Optional: color in the overview ruler
        // overviewRulerLane: vscode.OverviewRulerLane.Left,
      }),
      modified: vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        gutterIconPath: this.createGutterIcon('rgba(0, 150, 255, 0.7)'), // Bluish
        // overviewRulerColor: 'rgba(0, 150, 255, 0.7)',
        // overviewRulerLane: vscode.OverviewRulerLane.Left,
      }),
    };

    // Listen for snapshot changes
    this.disposables.push(
      this.snapshotManager.onDidChangeSnapshots(() => {
        logVerbose('Decorator: Snapshots changed, triggering update.');
        this.triggerUpdateDecorations();
      }),
    );

    // Listen for editor changes
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(
        (editor) => {
          this.activeEditor = editor;
          if (editor) {
            logVerbose('Decorator: Active editor changed, triggering update.');
            this.triggerUpdateDecorations();
          }
        },
        null,
        this.disposables,
      ),
    );

    // Listen for text document changes (debounced)
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument(
        (event) => {
          if (
            this.activeEditor &&
            event.document === this.activeEditor.document
          ) {
            logVerbose(
              'Decorator: Document changed, triggering debounced update.',
            );
            this.triggerUpdateDecorations(true); // Use debounce
          }
        },
        null,
        this.disposables,
      ),
    );

    // Initial update
    if (this.activeEditor) {
      this.triggerUpdateDecorations();
    }
  }

  // Helper to create a simple colored block SVG for the gutter icon
  private createGutterIcon(color: string): vscode.Uri {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="${color}" /></svg>`;
    return vscode.Uri.parse(
      `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
    );
  }

  // Debounce mechanism for updates
  private triggerUpdateDecorations(debounce = false): void {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = undefined;
    }

    if (debounce) {
      this.timeout = setTimeout(() => this.updateDecorations(), 500); // 500ms debounce
    } else {
      this.updateDecorations();
    }
  }

  private async updateDecorations(): Promise<void> {
    if (!this.activeEditor) {
      logVerbose('Decorator: No active editor, clearing decorations.');
      return;
    }

    const editor = this.activeEditor;
    const document = editor.document;
    const workspaceRoot = this.snapshotManager.getWorkspaceRoot(); // Use public getter

    if (!workspaceRoot || document.uri.scheme !== 'file') {
      logVerbose('Decorator: Not a file in workspace, clearing decorations.');
      this.clearDecorations(editor); // Clear decorations for non-workspace files
      return;
    }

    const relativePath = vscode.workspace.asRelativePath(document.uri, false); // Use VS Code's relative path

    // Get the last snapshot
    const snapshots = this.snapshotManager.getSnapshots();
    if (snapshots.length === 0) {
      logVerbose('Decorator: No snapshots exist, clearing decorations.');
      this.clearDecorations(editor);
      return;
    }
    const lastSnapshot = snapshots[snapshots.length - 1];

    try {
      logVerbose(
        `Decorator: Comparing ${relativePath} with snapshot ${lastSnapshot.id}`,
      );
      const snapshotContent =
        await this.snapshotManager.getSnapshotFileContentPublic(
          lastSnapshot.id,
          relativePath,
        );

      // If file didn't exist in the last snapshot or content is null (error?), clear decorations
      if (snapshotContent === null) {
        logVerbose(
          `Decorator: File ${relativePath} not found or content null in last snapshot. Clearing decorations.`,
        );
        this.clearDecorations(editor);
        return;
      }

      const currentContent = document.getText();

      // If content is identical, clear decorations
      if (snapshotContent === currentContent) {
        logVerbose(
          `Decorator: Content identical for ${relativePath}. Clearing decorations.`,
        );
        this.clearDecorations(editor);
        return;
      }

      // Calculate diff
      const lineDiffs = diff.diffLines(snapshotContent, currentContent);

      const addedLines: vscode.Range[] = [];
      const modifiedLines: vscode.Range[] = [];
      let currentLineIndex = 0;

      lineDiffs.forEach((part) => {
        const lineCount = part.count || 0;
        if (part.added) {
          // Treat all added lines as 'added' for simplicity now
          for (let i = 0; i < lineCount; i++) {
            addedLines.push(document.lineAt(currentLineIndex + i).range);
          }
        } else if (part.removed) {
          // Removed lines don't exist in the current editor, but they imply the lines *around* them might be 'modified'
          // A simple approach: mark the line *before* the deletion block as modified, if it exists and wasn't added.
          if (
            currentLineIndex > 0 &&
            !lineDiffs.find((p) => p.added && p.count && currentLineIndex > 0)
          ) {
            // Check if previous line wasn't added
            const prevLineRange = document.lineAt(currentLineIndex - 1).range;
            // Avoid double-marking if already marked as added
            if (!addedLines.some((r) => r.isEqual(prevLineRange))) {
              modifiedLines.push(prevLineRange);
            }
          }
          // We don't advance currentLineIndex for removed parts as they aren't in the current doc
          return; // Skip advancing line index for removed blocks
        } else {
          // Common lines - check if the *next* part is a removal, indicating modification
          const nextPartIndex = lineDiffs.indexOf(part) + 1;
          if (
            nextPartIndex < lineDiffs.length &&
            lineDiffs[nextPartIndex].removed
          ) {
            // Mark the last line of this common block as modified
            if (lineCount > 0) {
              const modRange = document.lineAt(
                currentLineIndex + lineCount - 1,
              ).range;
              // Avoid double-marking if already marked as added
              if (!addedLines.some((r) => r.isEqual(modRange))) {
                modifiedLines.push(modRange);
              }
            }
          }
        }
        // Advance line index only for added or common parts
        if (!part.removed) {
          currentLineIndex += lineCount;
        }
      });

      logVerbose(
        `Decorator: Applying decorations for ${relativePath}: +${addedLines.length} ~${modifiedLines.length}`,
      );
      editor.setDecorations(this.decorationTypes.added, addedLines);
      editor.setDecorations(this.decorationTypes.modified, modifiedLines);
    } catch (error) {
      log(
        `Decorator: Error updating decorations for ${relativePath}: ${error}`,
      );
      this.clearDecorations(editor); // Clear on error
    }
  }

  private clearDecorations(editor: vscode.TextEditor): void {
    editor.setDecorations(this.decorationTypes.added, []);
    editor.setDecorations(this.decorationTypes.modified, []);
  }

  public dispose(): void {
    log('Disposing EditorDecorator');
    if (this.timeout) {
      clearTimeout(this.timeout);
    }
    // Dispose decoration types
    Object.values(this.decorationTypes).forEach((type) => type.dispose());
    // Dispose listeners
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}
