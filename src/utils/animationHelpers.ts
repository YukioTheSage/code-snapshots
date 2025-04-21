import * as vscode from 'vscode';
import { log } from '../logger';

/**
 * Helper utilities for smoother transitions and animations
 */
export class AnimationHelpers {
  /**
   * Controls the decorative animation indicators during snapshot transitions
   */
  public static showTransitionIndicators(
    direction: 'forward' | 'backward',
  ): vscode.Disposable {
    // Create decorations for all visible text editors to show transition direction
    const decorationType = vscode.window.createTextEditorDecorationType({
      after: {
        contentText: direction === 'forward' ? '→' : '←',
        color: new vscode.ThemeColor(
          direction === 'forward'
            ? 'editorInfo.foreground'
            : 'editorWarning.foreground',
        ),
        margin: '0 0 0 20px',
      },
      isWholeLine: true,
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });

    // Apply decorations to the first few lines of each editor
    for (const editor of vscode.window.visibleTextEditors) {
      try {
        const document = editor.document;
        const decorations: vscode.DecorationOptions[] = [];

        // Add decorations to the first 3 lines
        for (let line = 0; line < Math.min(3, document.lineCount); line++) {
          const range = document.lineAt(line).range;
          decorations.push({ range });
        }

        editor.setDecorations(decorationType, decorations);
      } catch (error) {
        // Ignore decoration errors - this is just visual sugar
        log(`Error setting transition decorations: ${error}`);
      }
    }

    // Return disposable that cleans up the decorations
    return {
      dispose: () => {
        decorationType.dispose();
      },
    };
  }

  /**
   * Preserves editor state during navigation/transitions
   */
  public static async preserveEditorViewStates(): Promise<
    Map<string, EditorState>
  > {
    const states = new Map<string, EditorState>();

    for (const editor of vscode.window.visibleTextEditors) {
      // Only track file documents
      if (editor.document.uri.scheme !== 'file') continue;

      states.set(editor.document.uri.toString(), {
        uri: editor.document.uri,
        viewColumn: editor.viewColumn,
        selection: editor.selection,
        visibleRanges: editor.visibleRanges,
        options: editor.options,
      });
    }

    return states;
  }

  /**
   * Restores editor state after navigation/transitions
   */
  public static async restoreEditorViewStates(
    states: Map<string, EditorState>,
  ): Promise<void> {
    for (const [uriString, state] of states.entries()) {
      try {
        // Check if the document is still open
        const editor = vscode.window.visibleTextEditors.find(
          (e) => e.document.uri.toString() === uriString,
        );

        if (editor) {
          // Document is still open, restore state
          editor.selection = state.selection;
          editor.revealRange(
            state.visibleRanges[0],
            vscode.TextEditorRevealType.Default,
          );
        } else {
          // Document was closed, reopen it
          const document = await vscode.workspace.openTextDocument(state.uri);
          const newEditor = await vscode.window.showTextDocument(
            document,
            state.viewColumn || vscode.ViewColumn.Active,
          );

          // Then restore state
          newEditor.selection = state.selection;
          newEditor.revealRange(
            state.visibleRanges[0],
            vscode.TextEditorRevealType.Default,
          );
        }
      } catch (error) {
        // Log but continue with other editors
        log(`Error restoring editor state: ${error}`);
      }
    }
  }

  /**
   * Adds a subtle highlight effect to changed files in the explorer
   */
  public static highlightChangedFiles(_filePaths: string[]): vscode.Disposable {
    // This would be implemented with the FileDecorationsProvider API
    // For now, we're returning a no-op disposable as this would require
    // registering a new decoration provider in the extension
    return {
      dispose: () => {
        // no-op: placeholder disposable for highlight feature
      },
    };
  }
}

/**
 * Interface for storing editor state during transitions
 */
export interface EditorState {
  uri: vscode.Uri;
  viewColumn?: vscode.ViewColumn;
  selection: vscode.Selection;
  visibleRanges: readonly vscode.Range[];
  options: vscode.TextEditorOptions;
}
