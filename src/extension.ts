import * as vscode from 'vscode';
import { SnapshotManager } from './snapshotManager'; // Import Snapshot interface if needed
import { SnapshotQuickPick } from './ui/quickPick'; // Import new QuickPick UI
import { SnapshotTreeDataProvider, SnapshotType } from './ui/treeView';
import { FilterStatusBar } from './ui/filterStatusBar';
import { WelcomeView } from './ui/welcomeView';
import { ConfigTreeDataProvider } from './ui/configTreeView';

import { StatusBarController } from './statusBarController';
import { EditorDecorator } from './editorDecorator'; // Import the new decorator
import { initializeLogger, log } from './logger';
import { SnapshotContentProvider } from './snapshotContentProvider'; // Import the new provider
import { registerCommands, CommandDependencies } from './commands'; // Import the new command registration function and interface
import { ChangeNotifier } from './changeNotifier'; // Import the new notifier class
import { GitExtension, API as GitAPI } from './types/git.d'; // Import Git API types
import { getGitAutoSnapshotEnabled } from './config'; // Import config helper
import { CredentialsManager } from './services/credentialsManager';
import { SemanticSearchService } from './services/semanticSearchService';
import { SemanticSearchWebview } from './ui/semanticSearchWebview';
import { TerminalApiService } from './services/terminalApiService';
import { CliConnectorService } from './services/cliConnectorService';

// --- Snapshot Content Provider Removed ---
// The class definition previously here has been moved to src/snapshotContentProvider.ts
// --- End Snapshot Content Provider Removed ---

export async function activate(context: vscode.ExtensionContext) {
  // Make activate async
  // Initialize logger first
  initializeLogger(context);
  log('CodeLapse extension is activating...'); // Use logger

  try {
    // --- Get Git API ---
    let gitApi: GitAPI | null = null;
    try {
      const gitExtension =
        vscode.extensions.getExtension<GitExtension>('vscode.git');
      if (gitExtension) {
        if (!gitExtension.isActive) {
          log('Git extension found but not active, activating...');
          await gitExtension.activate(); // Wait for activation
        }
        gitApi = gitExtension.exports.getAPI(1);
        log('Successfully retrieved Git API.');
      } else {
        log('Git extension not found.');
      }
    } catch (err) {
      log(`Error getting Git API: ${err}`);
      // Proceed without Git API, features will be disabled
    }
    // --- End Get Git API ---

    // Create a status bar item to show extension status
    const statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
    statusBarItem.text = '$(loading~spin) CodeLapse activating...';
    statusBarItem.tooltip = 'CodeLapse extension is activating';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Initialize core components
    log('Initializing SnapshotManager...'); // Use logger
    const snapshotManager = new SnapshotManager(gitApi); // Pass Git API

    log('Initializing StatusBarController...'); // Use logger
    const statusBarController = new StatusBarController(snapshotManager);

    log('Initializing SnapshotQuickPick...'); // Use logger
    const snapshotQuickPick = new SnapshotQuickPick(snapshotManager);

    // Initialize Change Notifier
    log('Initializing ChangeNotifier...');
    const changeNotifier = new ChangeNotifier(context, snapshotManager);
    context.subscriptions.push(changeNotifier); // Add notifier to subscriptions for disposal
    log('ChangeNotifier initialized.');

    // Initialize Editor Decorator
    log('Initializing EditorDecorator...');
    const editorDecorator = new EditorDecorator(snapshotManager);
    context.subscriptions.push(editorDecorator); // Add decorator to subscriptions for disposal
    log('EditorDecorator initialized.');

    // Register the Tree View for Snapshots
    log('Registering Snapshot Tree View...');
    // Create tree data providers with different filter types
    const manualSnapshotTreeDataProvider = new SnapshotTreeDataProvider(
      snapshotManager,
      SnapshotType.MANUAL,
    );

    const autoSnapshotTreeDataProvider = new SnapshotTreeDataProvider(
      snapshotManager,
      SnapshotType.AUTO,
    );

    // Register manual snapshots tree view (upper view)
    const manualTreeView = vscode.window.registerTreeDataProvider(
      'manualSnapshotHistoryView',
      manualSnapshotTreeDataProvider,
    );
    context.subscriptions.push(manualTreeView);

    // Register auto snapshots tree view (lower view)
    const autoTreeView = vscode.window.registerTreeDataProvider(
      'autoSnapshotHistoryView',
      autoSnapshotTreeDataProvider,
    );
    context.subscriptions.push(autoTreeView);

    log('Snapshot Tree Views registered successfully');

    log('Initializing Filter Status Bars...');
    const manualFilterStatusBar = new FilterStatusBar(
      manualSnapshotTreeDataProvider,
      'My Snapshots',
    );
    context.subscriptions.push({
      dispose: () => {
        manualFilterStatusBar.dispose();
      },
    });

    const autoFilterStatusBar = new FilterStatusBar(
      autoSnapshotTreeDataProvider,
      'Auto Snapshots',
    );
    context.subscriptions.push({
      dispose: () => {
        autoFilterStatusBar.dispose();
      },
    });
    log('Filter Status Bars initialized.');

    // Register the Snapshot Content Provider for diff views
    log('Registering SnapshotContentProvider for diffs...');
    const snapshotDiffContentProvider = new SnapshotContentProvider(
      snapshotManager,
    );
    context.subscriptions.push(
      vscode.workspace.registerTextDocumentContentProvider(
        'snapshot-diff', // Use the new scheme for diffs
        snapshotDiffContentProvider,
      ),
    );
    log('SnapshotContentProvider for diffs registered successfully');

    const credentialsManager = new CredentialsManager(context);
    const semanticSearchService = new SemanticSearchService(
      snapshotManager,
      credentialsManager,
      context,
    );
    const semanticSearchWebview = new SemanticSearchWebview(
      context,
      semanticSearchService,
    );
    (snapshotManager as any).semanticSearchService = semanticSearchService;
    context.subscriptions.push(semanticSearchService);

    // Initialize Terminal API Service
    log('Initializing TerminalApiService...');
    const terminalApiService = new TerminalApiService(
      snapshotManager,
      semanticSearchService,
    );
    log('TerminalApiService initialized successfully');

    // Initialize CLI Connector Service
    log('Initializing CliConnectorService...');
    const cliConnectorService = new CliConnectorService(
      terminalApiService,
      context,
    );
    context.subscriptions.push(cliConnectorService);
    log('CliConnectorService initialized successfully');

    const config = vscode.workspace.getConfiguration('vscode-snapshots');
    const autoIndex = config.get<boolean>('semanticSearch.autoIndex', false);
    if (autoIndex) {
      // Use setTimeout to not block extension activation
      setTimeout(() => {
        semanticSearchService.indexAllSnapshots().catch((error) => {
          log(`Auto-indexing error: ${error}`);
        });
      }, 10000); // Wait 10 seconds after extension activation
    }
    // --- Notification logic moved to src/changeNotifier.ts ---

    // Create dependencies object - Explicitly type it
    const dependencies: CommandDependencies = {
      context,
      snapshotManager,
      snapshotQuickPick,
      snapshotTreeDataProvider: manualSnapshotTreeDataProvider, // Use manual as default
      autoSnapshotTreeDataProvider, // Add the auto provider
      changeNotifier,
      gitApi,
      semanticSearchService,
      semanticSearchWebview,
    };

    // Register all commands using the new function
    registerCommands(dependencies);

    // Expose the API for external use
    const api = {
      snapshotManager,
      terminalApi: terminalApiService,
      // Legacy compatibility
      getSnapshots: () => terminalApiService.getSnapshots(),
      takeSnapshot: (options: any) => terminalApiService.takeSnapshot(options),
      restoreSnapshot: (id: string, options?: any) =>
        terminalApiService.restoreSnapshot(id, options),
      deleteSnapshot: (id: string) => terminalApiService.deleteSnapshot(id),
      searchSnapshots: (query: string, options?: any) =>
        terminalApiService.searchSnapshots(query, options),
    };

    // Register the API command
    context.subscriptions.push(
      vscode.commands.registerCommand('vscode-snapshots.getApi', () => api),
    );

    // Register status bar controller for disposal
    context.subscriptions.push({
      dispose: () => {
        statusBarController.dispose();
      },
    });

    // Register Config Tree View for settings
    const configTreeDataProvider = new ConfigTreeDataProvider(context);
    context.subscriptions.push(
      vscode.window.registerTreeDataProvider(
        'configSettingsView',
        configTreeDataProvider,
      ),
    );

    // --- Setup Git Command Interception ---
    setupGitCommandInterception(context, snapshotManager);
    // --- End Git Command Interception ---

    // Setup auto-snapshot timer if enabled
    // TODO: Move config reading to config module if not already there
    let autoSnapshotTimer: NodeJS.Timeout | undefined;

    // Setup auto-snapshot timer if enabled
    const setupAutoSnapshotTimer = () => {
      // Clear existing timer if present
      if (autoSnapshotTimer) {
        clearInterval(autoSnapshotTimer);
        autoSnapshotTimer = undefined;
        log('Auto-snapshot timer cleared');
      }

      const config = vscode.workspace.getConfiguration('vscode-snapshots');
      const autoSnapshotInterval = config.get<number>(
        'autoSnapshotInterval',
        0,
      );

      if (autoSnapshotInterval > 0) {
        log(
          `Setting up auto-snapshot interval: ${autoSnapshotInterval} minutes`,
        );
        const intervalMs = autoSnapshotInterval * 60 * 1000;
        autoSnapshotTimer = setInterval(async () => {
          try {
            log('Auto-snapshot triggered by timer');
            const lastIdx = snapshotManager.getCurrentSnapshotIndex();
            if (lastIdx >= 0) {
              const lastSnapshot = snapshotManager.getSnapshots()[lastIdx];
              const workspaceRoot = snapshotManager.getWorkspaceRoot();
              if (workspaceRoot) {
                const changes = await snapshotManager.calculateRestoreChanges(
                  lastSnapshot,
                  workspaceRoot,
                );
                if (changes.length === 0) {
                  log(
                    'Skipping timer-based auto snapshot: no changes detected since last snapshot',
                  );
                  return;
                }
              }
            }
            // Take snapshot with enhanced context information
            const now = new Date();
            const formattedTime = now.toLocaleTimeString();
            const formattedDate = now.toLocaleDateString();

            await snapshotManager.takeSnapshot(
              `Auto snapshot at ${formattedTime}`,
              {
                tags: ['auto', 'timed', 'scheduled'],
                notes: `Automatically created snapshot from the ${autoSnapshotInterval}-minute interval setting on ${formattedDate} at ${formattedTime}`,
                isFavorite: false, // Generally auto-snapshots aren't favorites
              },
            );

            log('Time-based auto-snapshot completed successfully');
          } catch (error: unknown) {
            const errMsg =
              error instanceof Error ? error.message : String(error);
            log(`Auto-snapshot failed: ${errMsg}`);
          }
        }, intervalMs);

        // Register for disposal
        context.subscriptions.push({
          dispose: () => {
            if (autoSnapshotTimer) {
              clearInterval(autoSnapshotTimer);
              autoSnapshotTimer = undefined;
            }
          },
        });
      } else {
        log('Auto-snapshot timer is disabled (interval set to 0)');
      }
    };

    setupAutoSnapshotTimer();

    // Add configuration change listener
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('vscode-snapshots.autoSnapshotInterval')) {
          log('Auto-snapshot interval configuration changed');
          setupAutoSnapshotTimer();
        }
      }),
    );

    // --- First-time User Experience and Tour ---
    log('Initializing welcome experience...');
    // Register the Getting Started command for the command palette
    WelcomeView.registerGettingStartedCommand(context);

    // Show welcome view for first-time users
    WelcomeView.showWelcomeExperience(context);

    // Add keyboard shortcut hints to status bar for better discoverability
    const takingSnapshotHintShown = context.globalState.get<boolean>(
      'codeSnapshots.takingSnapshotHintShown',
      false,
    );
    if (!takingSnapshotHintShown) {
      // Show keyboard shortcut hint after a short delay
      setTimeout(() => {
        vscode.window
          .showInformationMessage(
            'Pro tip: Take a snapshot quickly with Ctrl+Alt+S (Cmd+Alt+S on Mac)',
            "Don't Show Again",
          )
          .then((selection) => {
            if (selection === "Don't Show Again") {
              context.globalState.update(
                'codeSnapshots.takingSnapshotHintShown',
                true,
              );
            }
          });
      }, 10000); // Show after 10 seconds
    }

    // Register additional command that will be needed for the UX improvements
    const registerFocusSnapshotViewCommand = (
      context: vscode.ExtensionContext,
    ): void => {
      const focusViewCmd = vscode.commands.registerCommand(
        'vscode-snapshots.focusSnapshotView',
        async () => {
          await vscode.commands.executeCommand(
            'workbench.view.extension.snapshot-explorer',
          );
        },
      );
      context.subscriptions.push(focusViewCmd);
      log('focusSnapshotView command registered');
    };

    registerFocusSnapshotViewCommand(context);

    // Enhance status bar with more help
    statusBarItem.tooltip =
      'CodeLapse extension is active\nClick to view snapshots\nCtrl+Alt+S to take a snapshot';

    // Log successful activation
    log('CodeLapse extension activated successfully'); // Use logger
    statusBarItem.text = '$(check) CodeLapse';
    statusBarItem.tooltip = 'CodeLapse extension is active';

    // Add the diagnostics command to the status bar
    statusBarItem.command = 'vscode-snapshots.diagnostics';

    // Don't show message on every activation, maybe only first time?
    // vscode.window.showInformationMessage(
    //   "CodeLapse extension is ready. Click on the status bar icon for diagnostics."
    // );
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log(`ACTIVATION ERROR: ${errMsg}`); // Use logger
    log((error as Error).stack || 'No stack trace available'); // Use logger
    vscode.window.showErrorMessage(
      `Failed to activate CodeLapse extension: ${errMsg}`,
    );
  }
}

export function deactivate() {
  // Clean up resources when extension is deactivated
}

// --- Helper Function for Git Command Interception ---

function setupGitCommandInterception(
  context: vscode.ExtensionContext,
  snapshotManager: SnapshotManager,
) {
  const gitCommandsToWrap = ['git.pull', 'git.merge', 'git.rebase']; // Add more if needed, e.g., git.sync, git.pullRebase

  log('Setting up Git command interception...');

  gitCommandsToWrap.forEach((commandId) => {
    const disposable = vscode.commands.registerCommand(
      `vscode-snapshots.internal.preGitCommand.${commandId}`, // Use a unique internal command ID
      async (...args: unknown[]): Promise<void> => {
        // Check configuration *at the time of execution*
        const autoSnapshotEnabled = getGitAutoSnapshotEnabled(); // Use config helper

        if (autoSnapshotEnabled) {
          log(`Intercepted Git command: ${commandId}.`);
          const lastIdx = snapshotManager.getCurrentSnapshotIndex();
          let shouldSnapshot = true;
          if (lastIdx >= 0) {
            const lastSnapshot = snapshotManager.getSnapshots()[lastIdx];
            const { added, modified, deleted } =
              snapshotManager.getSnapshotChangeSummary(lastSnapshot.id);
            if (added + modified + deleted === 0) {
              shouldSnapshot = false;
              log(
                'Skipping git-based auto snapshot: no changes detected since last snapshot',
              );
            }
          }
          if (shouldSnapshot) {
            try {
              // Take snapshot silently with a descriptive message
              const description = `Auto-snapshot before ${commandId}`;
              await snapshotManager.takeSnapshot(description, {
                tags: ['auto', 'git', commandId],
              }); // Mark as auto for skip logic
              log(`Auto-snapshot taken successfully before ${commandId}.`);
            } catch (error: unknown) {
              const errMsg =
                error instanceof Error ? error.message : String(error);
              log(
                `Failed to take auto-snapshot before ${commandId}: ${errMsg}`,
              );
              vscode.window.showWarningMessage(
                `Failed to take automatic snapshot before ${commandId}. Proceeding with Git operation.`,
              );
            }
          }
        } else {
          log(
            `Intercepted Git command: ${commandId}. Auto-snapshot disabled, skipping.`,
          );
        }

        // Execute the original Git command
        log(`Executing original Git command: ${commandId}`);
        try {
          await vscode.commands.executeCommand(commandId, ...args);
          log(`Original Git command ${commandId} executed successfully.`);
        } catch (error: unknown) {
          const errMsg = error instanceof Error ? error.message : String(error);
          log(`Error executing original Git command ${commandId}: ${errMsg}`);
        }
      },
    );

    context.subscriptions.push(disposable);
    log(`Registered wrapper for Git command: ${commandId}`);
  });

  log('Git command interception setup complete.');
}

// --- End Helper Function ---
