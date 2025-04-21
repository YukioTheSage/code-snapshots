import * as vscode from 'vscode';
import { log } from '../logger';

/**
 * Manages the welcome experience for first-time users
 */
export class WelcomeView {
  /**
   * Show the welcome view for first-time users
   * @param context Extension context
   */
  public static async showWelcomeExperience(
    context: vscode.ExtensionContext,
  ): Promise<void> {
    // Check if we've shown the welcome before
    const hasShownWelcome = context.globalState.get<boolean>(
      'codeSnapshots.hasShownWelcome',
    );

    if (hasShownWelcome) {
      return; // Don't show welcome if already shown
    }

    // Show welcome message with actions
    const selection = await vscode.window.showInformationMessage(
      'Welcome to Code Snapshots! Take snapshots of your code as you work to easily track your progress.',
      'Take a Tour',
      'Show Commands',
      'Learn More',
    );

    // Mark as shown regardless of action taken
    await context.globalState.update('codeSnapshots.hasShownWelcome', true);

    // Handle selection
    if (selection === 'Take a Tour') {
      this.startTour();
    } else if (selection === 'Show Commands') {
      vscode.commands.executeCommand(
        'workbench.action.quickOpen',
        '>Code Snapshots',
      );
    } else if (selection === 'Learn More') {
      vscode.env.openExternal(
        vscode.Uri.parse('https://github.com/your-username/vscode-snapshots'),
      );
    }

    log('Welcome experience shown to user');
  }

  /**
   * Start the guided tour of the extension
   */
  private static async startTour(): Promise<void> {
    // Show first step
    const step1 = await vscode.window.showInformationMessage(
      'Step 1: Taking your first snapshot. Press Ctrl+Alt+S (or Cmd+Alt+S on Mac) to take a snapshot of your code.',
      'Next',
      'Skip Tour',
    );

    if (step1 === 'Skip Tour') {
      return;
    }

    // Show second step
    const step2 = await vscode.window.showInformationMessage(
      'Step 2: View your snapshots in the Code Snapshots sidebar. Click the history icon in the Activity Bar.',
      'Next',
      'Skip Tour',
    );

    if (step2 === 'Skip Tour') {
      return;
    }

    // Show third step
    const step3 = await vscode.window.showInformationMessage(
      'Step 3: Navigate between snapshots using the forward/backward buttons or directly from the sidebar.',
      'Next',
      'Skip Tour',
    );

    if (step3 === 'Skip Tour') {
      return;
    }

    // Show final step
    await vscode.window.showInformationMessage(
      "Tour complete! You're ready to use Code Snapshots. For more help, check the extension documentation.",
      'Start Using Snapshots',
    );

    // Focus on the snapshots view
    vscode.commands.executeCommand(
      'workbench.view.extension.snapshot-explorer',
    );
  }

  /**
   * Register a command for accessing the Getting Started guide
   * @param context Extension context
   */
  public static registerGettingStartedCommand(
    context: vscode.ExtensionContext,
  ): void {
    const gettingStartedCmd = vscode.commands.registerCommand(
      'vscode-snapshots.gettingStarted',
      async () => {
        await this.startTour();
      },
    );

    context.subscriptions.push(gettingStartedCmd);
    log('Getting Started command registered');
  }
}
