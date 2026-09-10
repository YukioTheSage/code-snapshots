import * as vscode from 'vscode';
import { log } from '../logger';

/**
 * Helper utilities for the snapshot transition indicator.
 *
 * This class used to carry `preserveEditorViewStates`,
 * `restoreEditorViewStates` and `highlightChangedFiles` as well. The first two
 * were duplicated verbatim in `commands.ts` (which is what actually calls them)
 * and the third was a documented no-op placeholder, so all three were removed
 * rather than kept as unreachable surface.
 */
export class AnimationHelpers {
  /**
   * Controls the decorative animation indicators during snapshot transitions
   * @param direction 'forward' to show →, 'backward' to show ←
   * @returns Disposable to clean up the decorations
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
}
