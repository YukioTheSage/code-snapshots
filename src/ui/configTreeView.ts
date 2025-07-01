import * as vscode from 'vscode';
import { CredentialsManager } from '../services/credentialsManager';

interface ConfigItem {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'api-key';
  section?: string;
}

interface ConfigTreeItem {
  key: string;
  label: string;
  value: string;
  section?: string;
  collapsibleState?: vscode.TreeItemCollapsibleState;
  contextValue?: string;
}

export class ConfigTreeDataProvider
  implements vscode.TreeDataProvider<ConfigTreeItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    ConfigTreeItem | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private credentialsManager: CredentialsManager;
  private configItems: ConfigItem[] = [
    // Regular configuration items
    {
      key: 'snapshotLocation',
      label: 'Snapshot Location',
      type: 'string',
      section: 'General',
    },
    {
      key: 'maxSnapshots',
      label: 'Max Snapshots',
      type: 'number',
      section: 'General',
    },
    {
      key: 'autoSnapshotInterval',
      label: 'Auto Snapshot Interval (min)',
      type: 'number',
      section: 'General',
    },
    {
      key: 'loggingEnabled',
      label: 'Enable Logging',
      type: 'boolean',
      section: 'General',
    },
    {
      key: 'verboseLogging',
      label: 'Enable Verbose Logging',
      type: 'boolean',
      section: 'General',
    },
    {
      key: 'git.autoSnapshotBeforeOperation',
      label: 'Auto Snapshot Before Git Operations',
      type: 'boolean',
      section: 'General',
    },
    {
      key: 'autoSnapshot.rules',
      label: 'Auto Snapshot Rules',
      type: 'string',
      section: 'General',
    },
    {
      key: 'showOnlyChangedFiles',
      label: 'Show Only Changed Files',
      type: 'boolean',
      section: 'General',
    },
    {
      key: 'ux.showWelcomeOnStartup',
      label: 'Show Welcome On Startup',
      type: 'boolean',
      section: 'UX',
    },
    {
      key: 'ux.showKeyboardShortcutHints',
      label: 'Show Keyboard Shortcut Hints',
      type: 'boolean',
      section: 'UX',
    },
    {
      key: 'ux.useAnimations',
      label: 'Use Animations',
      type: 'boolean',
      section: 'UX',
    },
    {
      key: 'ux.confirmRestoreOperations',
      label: 'Confirm Restore Operations',
      type: 'boolean',
      section: 'UX',
    },
    // API key configurations
    {
      key: 'pineconeApiKey',
      label: 'Pinecone API Key',
      type: 'api-key',
      section: 'API Keys',
    },
    {
      key: 'geminiApiKey',
      label: 'Gemini API Key',
      type: 'api-key',
      section: 'API Keys',
    },
  ];

  constructor(private context: vscode.ExtensionContext) {
    this.credentialsManager = new CredentialsManager(context);
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('vscode-snapshots')) {
          this.refresh();
        }
      }),
      vscode.commands.registerCommand(
        'vscode-snapshots.editConfig',
        async (key: string) => {
          const config = vscode.workspace.getConfiguration('vscode-snapshots');
          const item = this.configItems.find((i) => i.key === key);
          if (!item) {
            return;
          }
          let newValue: string | boolean | number | undefined;
          switch (item.type) {
            case 'boolean': {
              const choice = await vscode.window.showQuickPick(
                ['true', 'false'],
                { placeHolder: `Set ${item.label}` },
              );
              if (choice === undefined) return;
              newValue = choice === 'true';
              break;
            }
            case 'number': {
              const input = await vscode.window.showInputBox({
                prompt: `Set ${item.label}`,
                value: String(config.get(key)),
              });
              if (input === undefined) return;
              const num = Number(input);
              if (Number.isNaN(num)) {
                vscode.window.showErrorMessage('Invalid number');
                return;
              }
              newValue = num;
              break;
            }
            case 'string': {
              const str = await vscode.window.showInputBox({
                prompt: `Set ${item.label}`,
                value: String(config.get(key, '')),
              });
              if (str === undefined) return;
              newValue = str;
              break;
            }
            case 'api-key': {
              // Handle API key update
              const str = await vscode.window.showInputBox({
                prompt: `Enter your ${item.label}`,
                password: true, // Mask the input for security
                ignoreFocusOut: true, // Keep the input box open when focus is lost
              });
              if (str === undefined) return;

              try {
                if (key === 'pineconeApiKey') {
                  await this.credentialsManager.setFPineconeApiKey(str);
                  vscode.window.showInformationMessage(
                    'Pinecone API key updated successfully. Reinitializing services...',
                  );
                  // Reinitialize vector database service for indexing
                  await this.reinitializeServices('pinecone');
                } else if (key === 'geminiApiKey') {
                  await this.credentialsManager.setGeminiApiKey(str);
                  vscode.window.showInformationMessage(
                    'Gemini API key updated successfully. Reinitializing services...',
                  );
                  // Reinitialize embedding service for semantic search
                  await this.reinitializeServices('gemini');
                }
                // No need to update config since we store in SecretStorage
                this.refresh();
                return;
              } catch (error) {
                vscode.window.showErrorMessage(
                  `Failed to update API key: ${error}`,
                );
                return;
              }
            }
          }
          await config.update(key, newValue, true);
          this.refresh();
        },
      ),
    );
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  /**
   * Reinitialize services when API keys are updated
   * @param keyType The type of API key that was updated ('pinecone' or 'gemini')
   */
  /**
   * Reinitialize services when API keys are updated
   * @param keyType The type of API key that was updated ('pinecone' or 'gemini')
   */
  async reinitializeServices(keyType: 'pinecone' | 'gemini'): Promise<void> {
    try {
      // Get services registered in the extension context
      const vectorDbService = this.context.globalState.get(
        'vectorDatabaseService',
      ) as {
        initialize?: (force?: boolean) => Promise<void>;
      };
      const embeddingService = this.context.globalState.get(
        'embeddingService',
      ) as {
        initialize?: (force?: boolean) => Promise<void>;
      };
      const indexingService = this.context.globalState.get(
        'indexingService',
      ) as {
        initialize?: (force?: boolean) => Promise<void>;
      };

      if (keyType === 'pinecone') {
        // Reinitialize vector database service (for indexing)
        if (
          vectorDbService &&
          typeof vectorDbService.initialize === 'function'
        ) {
          try {
            await vectorDbService.initialize(true); // Force reinitialization
            vscode.window.showInformationMessage(
              'Vector database service reinitialized with new API key',
            );
          } catch (e) {
            console.error('Failed to reinitialize vector database service:', e);
          }
        }

        // Also reinitialize indexing service if available
        if (
          indexingService &&
          typeof indexingService.initialize === 'function'
        ) {
          try {
            await indexingService.initialize(true);
            vscode.window.showInformationMessage(
              'Indexing service reinitialized with new API key',
            );
          } catch (e) {
            console.error('Failed to reinitialize indexing service:', e);
          }
        }
      } else if (keyType === 'gemini') {
        // Reinitialize embedding service (for semantic search)
        if (
          embeddingService &&
          typeof embeddingService.initialize === 'function'
        ) {
          try {
            await embeddingService.initialize(true); // Force reinitialization
            vscode.window.showInformationMessage(
              'Embedding service reinitialized with new API key',
            );
          } catch (e) {
            console.error('Failed to reinitialize embedding service:', e);
          }
        }
      }

      // Notice about potential restart requirement
      vscode.window
        .showInformationMessage(
          'API key updated. Some services may require a restart to fully apply changes.',
          'Restart Now',
        )
        .then((selection) => {
          if (selection === 'Restart Now') {
            vscode.commands.executeCommand('workbench.action.reloadWindow');
          }
        });
    } catch (error) {
      vscode.window.showErrorMessage(`Error reinitializing services: ${error}`);
      console.error('Error reinitializing services:', error);
    }
  }

  getTreeItem(element: ConfigTreeItem): vscode.TreeItem {
    // If this is a section header
    if (element.collapsibleState !== undefined) {
      const treeItem = new vscode.TreeItem(
        element.label,
        element.collapsibleState,
      );
      if (element.contextValue) {
        treeItem.contextValue = element.contextValue;
      }
      return treeItem;
    }

    // Regular config item
    const treeItem = new vscode.TreeItem(
      element.label,
      vscode.TreeItemCollapsibleState.None,
    );
    treeItem.description = element.value;
    treeItem.command = {
      command: 'vscode-snapshots.editConfig',
      title: 'Edit Setting',
      arguments: [element.key],
    };
    return treeItem;
  }

  async getChildren(element?: ConfigTreeItem): Promise<ConfigTreeItem[]> {
    // If we're getting the root items, show section headers
    if (!element) {
      // Get unique sections
      const sections = Array.from(
        new Set(this.configItems.map((item) => item.section || 'General')),
      );
      return sections.map((section) => ({
        key: `section-${section}`,
        label: section,
        value: '',
        collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
        contextValue: 'section',
      }));
    }

    // If we're getting children of a section
    const sectionName = element.label;
    const config = vscode.workspace.getConfiguration('vscode-snapshots');
    const sectionItems = this.configItems.filter(
      (item) => item.section === sectionName,
    );
    const results: ConfigTreeItem[] = [];
    for (const item of sectionItems) {
      let value = '';

      if (item.type === 'api-key') {
        if (item.key === 'pineconeApiKey') {
          const key = await this.credentialsManager.getPineconeApiKey();
          value = key ? '●●●●●●●●●●●●' : 'Not set';
        } else if (item.key === 'geminiApiKey') {
          const key = await this.credentialsManager.getGeminiApiKey();
          value = key ? '●●●●●●●●●●●●' : 'Not set';
        }
      } else {
        value = String(config.get(item.key));
      }

      results.push({
        key: item.key,
        label: item.label,
        value,
        section: item.section,
      });
    }
    return results;
  }
}
