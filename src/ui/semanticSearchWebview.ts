import * as vscode from 'vscode';
import { log } from '../logger';
import { SemanticSearchService } from '../services/semanticSearchService';
import path = require('path');

export class SemanticSearchWebview {
  private panel: vscode.WebviewPanel | undefined;
  private context: vscode.ExtensionContext;
  private searchService: SemanticSearchService;

  constructor(
    context: vscode.ExtensionContext,
    searchService: SemanticSearchService,
  ) {
    this.context = context;
    this.searchService = searchService;
  }

  /**
   * Creates or reveals the semantic search panel
   */
  show() {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'semanticSearchPanel',
      'CodeLapse Semantic Search',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, 'media'),
        ],
      },
    );

    this.panel.iconPath = vscode.Uri.joinPath(
      this.context.extensionUri,
      'media',
      'icon.png',
    );

    this.panel.webview.html = this.getWebviewContent();

    this.panel.onDidDispose(
      () => {
        this.panel = undefined;
      },
      null,
      this.context.subscriptions,
    );

    this.setupMessageHandling();

    log('Semantic search panel opened');
  }

  /**
   * Sets up message handling between webview and extension
   */
  private setupMessageHandling() {
    this.panel!.webview.onDidReceiveMessage(
      async (message) => {
        // Debug: log all incoming messages from webview
        log(`Received message from webview: ${JSON.stringify(message)}`);
        vscode.window.showInformationMessage(
          `Webview message: ${message.command}`,
        );
        switch (message.command) {
          case 'debug':
            log('Webview debug:', ...message.args);
            break;
          case 'search':
            try {
              // Show progress while searching
              const results = await vscode.window.withProgress(
                {
                  location: vscode.ProgressLocation.Notification,
                  title: 'Searching snapshots...',
                  cancellable: false,
                },
                async () => {
                  return await this.searchService.searchCode({
                    query: message.query,
                    snapshotIds: message.snapshotIds,
                    languages: message.languages,
                    limit: message.limit || 20,
                    scoreThreshold: message.scoreThreshold || 0.65,
                  });
                },
              );

              // Send results back to webview
              this.panel!.webview.postMessage({
                command: 'searchResults',
                results: results,
              });
              // Debug: log and notify number of results posted
              log(
                `SemanticSearchWebview: posted searchResults with count ${results.length}`,
              );
              vscode.window.showInformationMessage(
                `Search results sent: ${results.length}`,
              );
            } catch (error: unknown) {
              const errorMessageText =
                error instanceof Error ? error.message : String(error);
              log(`Error during search: ${errorMessageText}`);

              this.panel!.webview.postMessage({
                command: 'error',
                message: `Search error: ${errorMessageText}`,
              });

              vscode.window.showErrorMessage(
                `Search failed: ${errorMessageText}`,
              );
            }
            break;

          case 'openFile':
            this.openFile(message.filePath, message.snapshotId, message.line);
            break;

          case 'compareWithCurrent':
            this.compareFileWithCurrent(message.filePath, message.snapshotId);
            break;
        }
      },
      undefined,
      this.context.subscriptions,
    );
  }

  /**
   * Opens a file from search results
   */
  private async openFile(filePath: string, snapshotId: string, line: number) {
    try {
      const jumpToSnapshot = await vscode.window.showQuickPick(
        [
          {
            label: 'View in Current State',
            description: 'Open the current version of this file',
          },
          {
            label: 'Jump to Snapshot',
            description: 'Restore the snapshot then open the file',
          },
        ],
        {
          placeHolder: 'How would you like to view this file?',
        },
      );

      if (!jumpToSnapshot) return;

      if (jumpToSnapshot.label === 'Jump to Snapshot') {
        // Restore the snapshot
        await vscode.commands.executeCommand(
          'vscode-snapshots.jumpToSnapshot',
          snapshotId,
        );
        // Add a small delay to allow workspace changes to settle after restore
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      // Get workspace root
      const workspaceRoot = this.searchService.getWorkspaceRoot();
      if (!workspaceRoot) {
        throw new Error('No workspace folder open');
      }

      // Open the file
      const fileUri = vscode.Uri.joinPath(
        vscode.Uri.file(workspaceRoot),
        filePath,
      );
      const document = await vscode.workspace.openTextDocument(fileUri);
      const editor = await vscode.window.showTextDocument(document);

      // Move to the specified line (ensure line is within bounds)
      const validLine = Math.max(0, Math.min(line, document.lineCount - 1));
      const position = new vscode.Position(validLine, 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(
        new vscode.Range(position, position),
        vscode.TextEditorRevealType.InCenter,
      );
    } catch (error: unknown) {
      const errorMessageText =
        error instanceof Error ? error.message : String(error);
      log(`Error opening file: ${errorMessageText}`);
      vscode.window.showErrorMessage(
        `Failed to open file: ${errorMessageText}`,
      );
    }
  }

  /**
   * Compares a file in a snapshot with the current version
   */
  private async compareFileWithCurrent(filePath: string, snapshotId: string) {
    try {
      // Find the snapshot to get the timestamp
      const snapshot = this.searchService.getSnapshotById(snapshotId);
      if (!snapshot) {
        throw new Error(`Snapshot ${snapshotId} not found.`);
      }

      // Determine workspace folder
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder open.');
        return;
      }

      // Use the provided filePath as the relative path within the workspace
      const relativePath = filePath;

      // Create arguments for the compare command
      const args = {
        snapshotId,
        relativePath,
        contextValue: 'snapshotFile',
        snapshotTimestamp: snapshot.timestamp,
        label: path.basename(filePath),
      };

      // Execute the existing compare command
      await vscode.commands.executeCommand(
        'vscode-snapshots.compareFileWithWorkspace',
        args,
      );
    } catch (error: unknown) {
      const errorMessageText =
        error instanceof Error ? error.message : String(error);
      log(`Error comparing file: ${errorMessageText}`);
      vscode.window.showErrorMessage(
        `Failed to compare file: ${errorMessageText}`,
      );
    }
  }

  /**
   * Gets the HTML content for the webview
   */
  private getWebviewContent(): string {
    // All content is inlined to avoid file access issues with esbuild
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>CodeLapse Semantic Search</title>
      <style>
        /* VS Code Theme Variables */
        :root {
          --container-padding: 20px;
          --section-spacing: 24px;
          --border-radius: 4px;
          --transition-fast: 0.15s ease;
          --transition-normal: 0.3s ease;
          --shadow-subtle: 0 2px 6px rgba(0, 0, 0, 0.1);
          --shadow-medium: 0 4px 12px rgba(0, 0, 0, 0.15);
        }

        /* Base Styles */
        body {
          padding: 0;
          margin: 0;
          color: var(--vscode-foreground);
          font-size: var(--vscode-font-size);
          font-weight: var(--vscode-font-weight);
          font-family: var(--vscode-font-family);
          background-color: var(--vscode-editor-background);
          line-height: 1.5;
        }

        /* Main Layout */
        .app-container {
          display: flex;
          flex-direction: column;
          height: 100vh;
          max-height: 100vh;
          overflow: hidden;
        }

        .app-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px var(--container-padding);
          background-color: var(--vscode-sideBar-background);
          border-bottom: 1px solid var(--vscode-panel-border);
        }

        .logo-container {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .logo {
          font-size: 1.4em;
        }

        .app-header h1 {
          font-size: 1.2em;
          margin: 0;
          font-weight: 400;
        }

        .header-actions {
          display: flex;
          gap: 8px;
        }

        .app-content {
          flex: 1;
          overflow-y: auto;
          padding: var(--container-padding);
          display: flex;
          flex-direction: column;
          gap: var(--section-spacing);
        }

        /* Search Section */
        .search-section {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .search-bar {
          display: flex;
          gap: 8px;
        }

        .search-input-container {
          position: relative;
          flex: 1;
        }

        .search-input-container input {
          width: 100%;
          padding: 8px 32px 8px 12px;
          border-radius: var(--border-radius);
          border: 1px solid var(--vscode-input-border);
          background-color: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          font-family: var(--vscode-font-family);
          font-size: var(--vscode-font-size);
          outline: none;
          transition: border-color var(--transition-fast);
        }

        .search-input-container input:focus {
          border-color: var(--vscode-focusBorder);
        }

        .clear-button {
          position: absolute;
          right: 8px;
          top: 50%;
          transform: translateY(-50%);
          background: transparent;
          border: none;
          color: var(--vscode-descriptionForeground);
          cursor: pointer;
          font-size: 12px;
          opacity: 0.7;
          padding: 4px;
          display: none;
        }

        .clear-button:hover {
          opacity: 1;
        }

        .primary-button {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 16px;
          background-color: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          border-radius: var(--border-radius);
          cursor: pointer;
          font-family: var(--vscode-font-family);
          font-size: var(--vscode-font-size);
          transition: background-color var(--transition-fast);
        }

        .primary-button:hover {
          background-color: var(--vscode-button-hoverBackground);
        }

        .primary-button:active {
          transform: translateY(1px);
        }

        .icon-button {
          background: transparent;
          border: none;
          color: var(--vscode-foreground);
          cursor: pointer;
          opacity: 0.7;
          padding: 4px 8px;
          border-radius: var(--border-radius);
        }

        .icon-button:hover {
          opacity: 1;
          background-color: var(--vscode-toolbar-hoverBackground);
        }

        /* Search Options */
        .search-options {
          margin-bottom: 8px;
        }

        .options-accordion {
          color: var(--vscode-foreground);
          border-radius: var(--border-radius);
          overflow: hidden;
        }

        .options-accordion summary {
          cursor: pointer;
          padding: 8px 12px;
          border-radius: var(--border-radius);
          background-color: var(--vscode-sideBar-background);
          position: relative;
          font-size: 0.9em;
          font-weight: 500;
        }

        .options-accordion summary:hover {
          background-color: var(--vscode-toolbar-hoverBackground);
        }

        .options-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
          gap: 16px;
          padding: 16px;
          border-radius: 0 0 var(--border-radius) var(--border-radius);
          border: 1px solid var(--vscode-panel-border);
          border-top: none;
        }

        .option-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .option-group label {
          font-size: 0.9em;
          color: var(--vscode-descriptionForeground);
        }

        .option-group select, 
        .option-group input[type="text"],
        .option-group input[type="number"] {
          padding: 6px 8px;
          border-radius: var(--border-radius);
          border: 1px solid var(--vscode-input-border);
          background-color: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          font-family: var(--vscode-font-family);
          font-size: var(--vscode-font-size);
        }

        .option-group select:focus,
        .option-group input:focus {
          border-color: var(--vscode-focusBorder);
          outline: none;
        }

        .language-group select {
          height: 120px;
        }

        /* Range Input */
        .range-input-container {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .range-input {
          flex: 1;
          -webkit-appearance: none;
          width: 100%;
          height: 4px;
          border-radius: 2px;
          background: var(--vscode-input-border);
          outline: none;
        }

        .range-input::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: var(--vscode-button-background);
          cursor: pointer;
        }

        .range-input::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: var(--vscode-button-background);
          cursor: pointer;
          border: none;
        }

        .range-value {
          min-width: 36px;
          text-align: center;
          font-variant-numeric: tabular-nums;
          color: var(--vscode-input-foreground);
          background-color: var(--vscode-input-background);
          padding: 2px 6px;
          border-radius: var(--border-radius);
          border: 1px solid var(--vscode-input-border);
          font-size: 0.9em;
        }

        /* Loader */
        .loader {
          display: none;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 24px;
          gap: 16px;
        }

        .spinner {
          width: 32px;
          height: 32px;
          border: 3px solid rgba(0, 0, 0, 0.1);
          border-radius: 50%;
          border-top-color: var(--vscode-progressBar-background);
          animation: spin 1s ease-in-out infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .loader-text {
          color: var(--vscode-descriptionForeground);
          font-size: 0.9em;
        }

        /* Error Message */
        .error-message {
          display: none;
          padding: 12px 16px;
          border-radius: var(--border-radius);
          background-color: var(--vscode-inputValidation-errorBackground);
          border: 1px solid var(--vscode-inputValidation-errorBorder);
          color: var(--vscode-inputValidation-errorForeground);
          margin: 8px 0;
        }

        /* Results Section */
        .results-section {
          display: none;
          flex-direction: column;
          gap: 16px;
        }

        .results-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-bottom: 8px;
          border-bottom: 1px solid var(--vscode-panel-border);
        }

        .results-header h2 {
          font-size: 1.1em;
          margin: 0;
          font-weight: 500;
        }

        .results-stats {
          font-size: 0.9em;
          color: var(--vscode-descriptionForeground);
        }

        .results-container {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        /* Result Item */
        .result-item {
          background-color: var(--vscode-sideBar-background);
          border-radius: var(--border-radius);
          border: 1px solid var(--vscode-panel-border);
          overflow: hidden;
          transition: transform var(--transition-fast), box-shadow var(--transition-fast);
          animation: fadeIn 0.3s ease-in-out;
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .result-item:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-subtle);
        }

        .result-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          background-color: var(--vscode-sideBarSectionHeader-background);
          border-bottom: 1px solid var(--vscode-panel-border);
        }

        .result-title {
          font-weight: 500;
          font-size: 1em;
          margin: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .result-score {
          padding: 2px 8px;
          border-radius: 10px;
          font-size: 0.8em;
          background-color: var(--vscode-badge-background);
          color: var(--vscode-badge-foreground);
          white-space: nowrap;
        }

        .result-meta {
          padding: 8px 16px;
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 8px;
          border-bottom: 1px solid var(--vscode-panel-border);
          font-size: 0.9em;
        }

        .result-path {
          color: var(--vscode-descriptionForeground);
          word-break: break-all;
          grid-column: 1 / -1;
        }

        .result-details {
          display: flex;
          flex-wrap: wrap;
          gap: 16px;
        }

        .result-detail {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .result-detail-label {
          color: var(--vscode-descriptionForeground);
        }

        .result-content-container {
          position: relative;
        }

        .result-content {
          padding: 16px;
          background-color: var(--vscode-editor-background);
          overflow-x: auto;
          font-family: var(--vscode-editor-font-family);
          font-size: var(--vscode-editor-font-size);
          white-space: pre;
          max-height: 200px;
          overflow-y: auto;
          line-height: 1.4;
        }

        .result-actions {
          display: flex;
          gap: 8px;
          padding: 12px 16px;
          background-color: var(--vscode-sideBar-background);
          border-top: 1px solid var(--vscode-panel-border);
        }

        .action-button {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          border-radius: var(--border-radius);
          background-color: var(--vscode-button-secondaryBackground);
          color: var(--vscode-button-secondaryForeground);
          border: none;
          cursor: pointer;
          font-family: var(--vscode-font-family);
          font-size: 0.9em;
          transition: background-color var(--transition-fast);
        }

        .action-button:hover {
          background-color: var(--vscode-button-secondaryHoverBackground);
        }

        /* Empty State */
        .empty-state {
          display: none;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 40px 20px;
          text-align: center;
          color: var(--vscode-descriptionForeground);
        }

        .empty-icon {
          font-size: 32px;
          margin-bottom: 16px;
          opacity: 0.7;
        }

        .empty-state h3 {
          margin: 0;
          margin-bottom: 8px;
          font-weight: 500;
          color: var(--vscode-foreground);
        }

        .empty-state p {
          max-width: 400px;
          margin: 0;
          line-height: 1.5;
        }

        /* Search Info */
        .search-info {
          display: none;
          font-size: 0.9em;
          color: var(--vscode-descriptionForeground);
          padding: 8px 12px;
          background-color: var(--vscode-textBlockQuote-background);
          border-left: 3px solid var(--vscode-textBlockQuote-border);
          border-radius: 0 var(--border-radius) var(--border-radius) 0;
          margin-top: 8px;
        }

        /* Tooltip */
        .tooltip {
          position: fixed;
          background-color: var(--vscode-editorHoverWidget-background);
          color: var(--vscode-editorHoverWidget-foreground);
          border: 1px solid var(--vscode-editorHoverWidget-border);
          padding: 6px 10px;
          border-radius: var(--border-radius);
          font-size: 0.9em;
          z-index: 1000;
          max-width: 300px;
          box-shadow: var(--shadow-medium);
          pointer-events: none;
          opacity: 0;
          transition: opacity var(--transition-fast);
        }

        /* Highlighting */
        .highlighter {
          background-color: var(--vscode-editor-findMatchHighlightBackground);
          color: inherit;
          border-radius: 2px;
          padding: 0 2px;
        }

        /* Responsive adjustments */
        @media (max-width: 600px) {
          .search-bar {
            flex-direction: column;
          }
          
          .options-grid {
            grid-template-columns: 1fr;
          }
          
          .button-text {
            display: none;
          }
          
          .primary-button {
            padding: 8px;
          }
        }
      </style>
    </head>
    <body>
      <div class="app-container">
        <header class="app-header">
          <div class="logo-container">
            <div class="logo">🔍</div>
            <h1>CodeLapse Semantic Search</h1>
          </div>
          <div class="header-actions">
            <button id="helpButton" class="icon-button" title="Help">
              <span class="icon">❔</span>
            </button>
          </div>
        </header>

        <main class="app-content">
          <section class="search-section">
            <div class="search-bar">
              <div class="search-input-container">
                <input 
                  type="text" 
                  id="searchInput" 
                  placeholder="Enter a natural language query (e.g., 'Where is user authentication handled?')" 
                  autocomplete="off"
                  autofocus
                >
                <button id="clearButton" class="clear-button" title="Clear search">✕</button>
              </div>
              <button id="searchButton" class="primary-button">
                <span class="button-text">Search</span>
                <span class="button-icon">🔍</span>
              </button>
            </div>

            <div class="search-options">
              <details class="options-accordion">
                <summary>Search Options</summary>
                <div class="options-grid">
                  <div class="option-group">
                    <label for="limitSelect">Result Limit</label>
                    <select id="limitSelect">
                      <option value="10">10 results</option>
                      <option value="20" selected>20 results</option>
                      <option value="50">50 results</option>
                      <option value="100">100 results</option>
                    </select>
                  </div>

                  <div class="option-group">
                    <label for="thresholdInput">Relevance Threshold</label>
                    <div class="range-input-container">
                      <input 
                        type="range" 
                        id="thresholdInput" 
                        min="0.1" 
                        max="0.99" 
                        step="0.05" 
                        value="0.65"
                        class="range-input"
                      >
                      <span id="thresholdValue" class="range-value">0.65</span>
                    </div>
                  </div>

                  <div class="option-group language-group">
                    <label for="languageSelect">Language Filter (Ctrl+Click for multiple)</label>
                    <select id="languageSelect" multiple>
                      <option value="javascript">JavaScript</option>
                      <option value="typescript">TypeScript</option>
                      <option value="python">Python</option>
                      <option value="java">Java</option>
                      <option value="c">C</option>
                      <option value="cpp">C++</option>
                      <option value="csharp">C#</option>
                      <option value="go">Go</option>
                      <option value="ruby">Ruby</option>
                      <option value="rust">Rust</option>
                      <option value="php">PHP</option>
                    </select>
                  </div>
                </div>
              </details>
            </div>

            <div class="search-info" id="searchInfo"></div>
          </section>

          <div class="loader" id="loader">
            <div class="spinner"></div>
            <div class="loader-text">Searching code snapshots...</div>
          </div>
          
          <div class="error-message" id="errorMessage"></div>
          
          <section class="results-section" id="resultsSection">
            <div class="results-header" id="resultsHeader">
              <h2>Search Results</h2>
              <div class="results-stats" id="resultsStats"></div>
            </div>
            
            <div class="results-container" id="resultsContainer">
              <!-- Search results will be injected here -->
            </div>
            
            <div class="empty-state" id="emptyState">
              <div class="empty-icon">🔍</div>
              <h3>No results found</h3>
              <p>Try adjusting your search query or lowering the relevance threshold.</p>
            </div>
          </section>
        </main>

        <div class="tooltip" id="tooltip"></div>
      </div>

      <script>
        // Self-executing function to encapsulate scope
        (function() {
          // Initialize communication with VSCode extension
          const vscode = acquireVsCodeApi();
          
          // Store state to persist between webview reloads
          let state = vscode.getState() || {
            lastQuery: '',
            lastOptions: {
              limit: 20,
              scoreThreshold: 0.65,
              languages: []
            }
          };
          
          // DOM Elements
          const elements = {
            // Search controls
            searchInput: document.getElementById('searchInput'),
            searchButton: document.getElementById('searchButton'),
            clearButton: document.getElementById('clearButton'),
            helpButton: document.getElementById('helpButton'),
            
            // Options
            limitSelect: document.getElementById('limitSelect'),
            thresholdInput: document.getElementById('thresholdInput'),
            thresholdValue: document.getElementById('thresholdValue'),
            languageSelect: document.getElementById('languageSelect'),
            
            // UI sections
            loader: document.getElementById('loader'),
            errorMessage: document.getElementById('errorMessage'),
            searchInfo: document.getElementById('searchInfo'),
            resultsSection: document.getElementById('resultsSection'),
            resultsContainer: document.getElementById('resultsContainer'),
            resultsHeader: document.getElementById('resultsHeader'),
            resultsStats: document.getElementById('resultsStats'),
            emptyState: document.getElementById('emptyState'),
            
            // Tooltip
            tooltip: document.getElementById('tooltip')
          };
          Object.entries(elements).forEach(([k, el]) => {
  if (!el) console.error(\`⚠️ Missing element: \${k}\`);
});
          // Initialize the UI
          function initializeUI() {
            // Restore last query if available
            if (state.lastQuery) {
              elements.searchInput.value = state.lastQuery;
              toggleClearButton();
            }
            
            // Restore last options
            if (state.lastOptions) {
              elements.limitSelect.value = state.lastOptions.limit || 20;
              elements.thresholdInput.value = state.lastOptions.scoreThreshold || 0.65;
              elements.thresholdValue.textContent = state.lastOptions.scoreThreshold || 0.65;
              
              // Restore selected languages
              if (state.lastOptions.languages && state.lastOptions.languages.length > 0) {
                Array.from(elements.languageSelect.options).forEach(option => {
                  option.selected = state.lastOptions.languages.includes(option.value);
                });
              }
            }
          }
          
          // --- Event Listeners ---
          
          // Search events
          elements.searchButton.addEventListener('click', performSearch);
          elements.searchInput.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
              performSearch();
            }
          });
          
          // Clear search input
          elements.clearButton.addEventListener('click', () => {
            elements.searchInput.value = '';
            elements.clearButton.style.display = 'none';
            elements.searchInput.focus();
          });
          
          // Show/hide clear button based on input content
          elements.searchInput.addEventListener('input', toggleClearButton);
          
          // Update threshold value display
          elements.thresholdInput.addEventListener('input', () => {
            elements.thresholdValue.textContent = elements.thresholdInput.value;
          });
          
          // Help button tooltip
          elements.helpButton.addEventListener('mouseenter', event => {
            showTooltip(event, 'Search for code using natural language queries like "Where is user authentication handled?" or "How are snapshots created?"');
          });
          
          elements.helpButton.addEventListener('mouseleave', () => {
            hideTooltip();
          });
          
          // Handle messages from the extension
          window.addEventListener('message', event => {
            const message = event.data; // The data sent from the extension
            
            // Debug output for easier troubleshooting
            console.log('Received message:', message);
            
            switch (message.command) {
              case 'searchResults':
                // Hide loader
                elements.loader.style.display = 'none';
                
                // Process and display results
                displayResults(message.results);
                break;
                
              case 'error':
                // Hide loader, show error
                elements.loader.style.display = 'none';
                showError(message.message);
                break;
            }
          });
          
          // --- Core Functions ---
          
          /**
           * Gathers search parameters and sends a search request to the extension.
           */
          function performSearch() {
            const query = elements.searchInput.value.trim();
            if (!query) {
              showError('Please enter a search query.');
              return;
            }
            
            // Get selected languages from the multiple select element
            const selectedLanguages = Array.from(elements.languageSelect.selectedOptions)
              .map(option => option.value);
            
            // Collect all search options
            const searchOptions = {
              command: 'search',
              query: query,
              limit: parseInt(elements.limitSelect.value, 10),
              scoreThreshold: parseFloat(elements.thresholdInput.value),
              languages: selectedLanguages.length > 0 ? selectedLanguages : undefined
            };
            
            // Save state for persistence
            state = {
              lastQuery: query,
              lastOptions: {
                limit: searchOptions.limit,
                scoreThreshold: searchOptions.scoreThreshold,
                languages: selectedLanguages
              }
            };
            vscode.setState(state);
            
            // Update UI: show loader, hide sections
            elements.loader.style.display = 'flex';
            elements.errorMessage.style.display = 'none';
            elements.resultsSection.style.display = 'none';
            elements.emptyState.style.display = 'none';
            elements.searchInfo.style.display = 'none';
            
            // Blur the input to hide mobile keyboard
            elements.searchInput.blur();
            
            // Send the search request to the extension
            vscode.postMessage(searchOptions);
          }
          
          /**
           * Displays the search results received from the extension.
           * @param {Array} results - Array of search result objects
           */
          function displayResults(results) {
            // Clear previous results
            elements.resultsContainer.innerHTML = '';
            
            if (!results || results.length === 0) {
              // Show empty state
              elements.emptyState.style.display = 'flex';
              elements.resultsSection.style.display = 'none';
              return;
            }
            
            // Show results section
            elements.resultsSection.style.display = 'flex';
            elements.emptyState.style.display = 'none';
            
            // Update stats
            elements.resultsStats.textContent = \`\${results.length} result\${results.length === 1 ? '' : 's'}\`;
            
            // Show search info
            elements.searchInfo.textContent = \`Searched for: "\${elements.searchInput.value.trim()}"\`;
            elements.searchInfo.style.display = 'block';
            
            // Create and append result items
            results.forEach((result, index) => {
              const resultElement = createResultElement(result, index);
              elements.resultsContainer.appendChild(resultElement);
              
              // Add a small delay between animations for a cascade effect
              setTimeout(() => {
                resultElement.style.opacity = '1';
                resultElement.style.transform = 'translateY(0)';
              }, index * 50);
            });
            
            // Highlight search terms after rendering
            highlightSearchTerms(elements.searchInput.value.trim());
          }
          
          /**
           * Creates a DOM element for a search result
           * @param {Object} result - The search result object
           * @param {Number} index - The result index for animation delay
           * @returns {HTMLElement} The constructed result element
           */
          function createResultElement(result, index) {
            // Format score as percentage
            const scorePercent = Math.round((result.score || 0) * 100);
            
            // Format date
            const date = new Date(result.timestamp).toLocaleString();
            
            // Get snapshot name/description
            const snapshotDescription = result.snapshot?.description || 'Unnamed snapshot';
            
            // Filename from path
            const fileName = result.filePath.split('/').pop();
            
            // Create result element
            const resultElement = document.createElement('div');
            resultElement.className = 'result-item';
            resultElement.style.opacity = '0';
            resultElement.style.transform = 'translateY(10px)';
            
            // Create result HTML
            resultElement.innerHTML = \`
              <div class="result-header">
                <h3 class="result-title">\${escapeHtml(fileName)}</h3>
                <div class="result-score">\${scorePercent}% match</div>
              </div>
              
              <div class="result-meta">
                <div class="result-path">\${escapeHtml(result.filePath)}</div>
                
                <div class="result-details">
                  <div class="result-detail">
                    <span class="result-detail-label">Snapshot:</span>
                    <span>\${escapeHtml(snapshotDescription)}</span>
                  </div>
                  
                  <div class="result-detail">
                    <span class="result-detail-label">Date:</span>
                    <span>\${escapeHtml(date)}</span>
                  </div>
                  
                  <div class="result-detail">
                    <span class="result-detail-label">Lines:</span>
                    <span>\${result.startLine + 1}-\${result.endLine + 1}</span>
                  </div>
                </div>
              </div>
              
              <div class="result-content-container">
                <div class="result-content">\${escapeHtml(result.content)}</div>
              </div>
              
              <div class="result-actions">
                <button class="action-button open-button" data-file="\${escapeHtml(result.filePath)}" data-snapshot="\${escapeHtml(result.snapshotId)}" data-line="\${result.startLine}">
                  <span class="button-icon">📄</span>
                  <span>Open File</span>
                </button>
                
                <button class="action-button compare-button" data-file="\${escapeHtml(result.filePath)}" data-snapshot="\${escapeHtml(result.snapshotId)}">
                  <span class="button-icon">⟷</span>
                  <span>Compare with Current</span>
                </button>
              </div>
            \`;
            
            // Add event listeners to action buttons
            const openButton = resultElement.querySelector('.open-button');
            openButton.addEventListener('click', () => {
              vscode.postMessage({
                command: 'openFile',
                filePath: openButton.dataset.file,
                snapshotId: openButton.dataset.snapshot,
                line: parseInt(openButton.dataset.line, 10)
              });
            });
            
            const compareButton = resultElement.querySelector('.compare-button');
            compareButton.addEventListener('click', () => {
              vscode.postMessage({
                command: 'compareWithCurrent',
                filePath: compareButton.dataset.file,
                snapshotId: compareButton.dataset.snapshot
              });
            });
            
            return resultElement;
          }
          
          /**
           * Displays an error message in the UI.
           * @param {string} message - The error message to display
           */
          function showError(message) {
            elements.errorMessage.textContent = message;
            elements.errorMessage.style.display = 'block';
          }
          
          /**
           * Shows or hides the clear button based on input content
           */
          function toggleClearButton() {
            elements.clearButton.style.display = 
              elements.searchInput.value.length > 0 ? 'block' : 'none';
          }
          
          /**
           * Displays a tooltip at the specified position
           * @param {Event} event - The event that triggered the tooltip
           * @param {string} message - The tooltip message
           */
          function showTooltip(event, message) {
            const tooltip = elements.tooltip;
            tooltip.textContent = message;
            
            // Position tooltip near the target
            const rect = event.target.getBoundingClientRect();
            tooltip.style.top = \`\${rect.bottom + 10}px\`;
            tooltip.style.left = \`\${rect.left + (rect.width / 2) - 150}px\`;
            
            // Show tooltip
            tooltip.style.opacity = '1';
          }
          
          /**
           * Hides the tooltip
           */
          function hideTooltip() {
            elements.tooltip.style.opacity = '0';
          }
          
          /**
           * Escapes HTML special characters to prevent XSS
           * @param {string} unsafe - The string to escape
           * @returns {string} The escaped string
           */
          function escapeHtml(unsafe) {
            if (unsafe === null || unsafe === undefined) {
              return '';
            }
            
            return String(unsafe)
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#39;');
          }
          
          /**
           * Escapes characters with special meaning in regular expressions
           * @param {string} str - The string to escape
           * @returns {string} The escaped string
           */
          function escapeRegExpChars(str) {
            return String(str || '').replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
          }
          
          /**
           * Highlights search terms in the result content
           * @param {string} query - The search query
           */
          function highlightSearchTerms(query) {
            if (!query) return;
            
            // Extract meaningful terms (3+ characters)
            const terms = query
              .toLowerCase()
              .split(/\\s+/)
              .filter(term => term.length > 2)
              .map(term => escapeRegExpChars(term));
            
            if (terms.length === 0) return;
            
            // Create regex pattern and apply highlighting
            const pattern = new RegExp(\`(\${terms.join('|')})\`, 'gi');
            
            document.querySelectorAll('.result-content').forEach(element => {
              const content = element.textContent || '';
              element.innerHTML = escapeHtml(content).replace(
                pattern,
                match => \`<span class="highlighter">\${match}</span>\`
              );
            });
          }
          
          // Debugging function
          function debug(message, data) {
            if (console && console.log) {
              console.log(\`[Semantic Search] \${message}\`, data);
            }
          }
          
          // Initialize the UI
          initializeUI();
          
        })();
      </script>
    </body>
    </html>`;
  }
}
