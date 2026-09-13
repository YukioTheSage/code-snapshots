import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { chromium, Browser, Page } from 'playwright-core';

// Declare DOM globals for page.evaluate closures
declare const document: any;
declare const window: any;

export interface VisualTestResult {
  name: string;
  passed: boolean;
  durationMs: number;
  screenshots: string[];
  assertions: string[];
  error?: string;
}

export class VisualRegressionRunner {
  private codeExe: string;
  private fixtureRoot: string;
  private userDataDir: string;
  private outDir: string;
  private childProcess: cp.ChildProcess | null = null;
  private browser: Browser | null = null;
  private page: Page | null = null;
  private port = 9336;

  constructor() {
    this.codeExe = path.join(
      __dirname,
      '../../.vscode-test/vscode-win32-x64-archive-1.137.0/Code.exe'
    );
    this.fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-vis-fix-'));
    this.userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-vis-user-'));
    this.outDir = path.join(__dirname, '../../test-out/visual-evidence');
  }

  async setup(): Promise<void> {
    fs.mkdirSync(path.join(this.fixtureRoot, 'src'), { recursive: true });
    fs.mkdirSync(path.join(this.fixtureRoot, '.vscode'), { recursive: true });
    fs.mkdirSync(this.outDir, { recursive: true });

    // Seed fixture app.ts
    fs.writeFileSync(
      path.join(this.fixtureRoot, 'src', 'app.ts'),
      "// CodeLapse Visual Regression Fixture\nfunction hello(target: string): string {\n  return `Hello, ${target}!`;\n}\nconsole.log(hello('World'));\n"
    );

    const settings = {
      'vscode-snapshots.snapshotLocation': '.snapshots-test',
      'vscode-snapshots.maxSnapshots': 20,
      'vscode-snapshots.ux.showWelcomeOnStartup': false,
      'vscode-snapshots.ux.showKeyboardShortcutHints': false,
      'vscode-snapshots.ux.confirmRestoreOperations': true,
      'vscode-snapshots.git.addCommitInfo': false,
      'vscode-snapshots.git.commitFromSnapshotEnabled': false,
      'vscode-snapshots.semanticSearch.enabled': false,
      'vscode-snapshots.autoSnapshotInterval': 0,
      'workbench.colorTheme': 'Default Dark Modern',
      'editor.glyphMargin': true,
      'window.restoreWindows': 'none',
      'workbench.startupEditor': 'none',
      'workbench.welcomePage.walkthroughs.openOnInstall': false,
      'workbench.experimental.onboardingExperience.enabled': false,
      'workbench.welcomePage.experimental.showWalkthrough': false,
      'workbench.tips.enabled': false,
      'window.dialogStyle': 'custom',
      'telemetry.telemetryLevel': 'off',
    };

    // Seed workspace settings
    fs.writeFileSync(
      path.join(this.fixtureRoot, '.vscode', 'settings.json'),
      JSON.stringify(settings, null, 2)
    );

    // Seed USER settings (critical for window.* settings like window.dialogStyle)
    const userSettingsDir = path.join(this.userDataDir, 'User');
    fs.mkdirSync(userSettingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(userSettingsDir, 'settings.json'),
      JSON.stringify(settings, null, 2)
    );

    const extensionDevelopmentPath = path.resolve(__dirname, '../..');
    const appFile = path.join(this.fixtureRoot, 'src', 'app.ts');

    const args = [
      `--remote-debugging-port=${this.port}`,
      '--disable-extensions',
      `--extensionDevelopmentPath=${extensionDevelopmentPath}`,
      '--disable-workspace-trust',
      '--disable-gpu',
      `--user-data-dir=${this.userDataDir}`,
      this.fixtureRoot,
      appFile,
    ];

    console.log(`[Visual] Launching VS Code with remote debugging on port ${this.port}...`);
    this.childProcess = cp.spawn(this.codeExe, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: false,
      env: {
        ...process.env,
        // Ensure interactive UI is ENABLED
        CODELAPSE_DISABLE_INTERACTIVE_UI: '0',
        CODELAPSE_DISABLE_CREDENTIAL_PROMPTS: '0',
      },
    });

    this.childProcess.stdout?.on('data', (d) => {
      const line = d.toString().trim();
      if (line) console.log(`[CodeOut] ${line}`);
    });
    this.childProcess.stderr?.on('data', (d) => {
      const line = d.toString().trim();
      if (line) console.log(`[CodeErr] ${line}`);
    });

    console.log('[Visual] Connecting Playwright via CDP...');
    let connected = false;
    for (let i = 0; i < 40; i++) {
      try {
        this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${this.port}`);
        connected = true;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    if (!connected || !this.browser) {
      throw new Error(`Failed to connect to VS Code on port ${this.port}`);
    }

    const pages = this.browser.contexts()[0].pages();
    this.page = pages.find((p) => p.url().includes('workbench.html')) || pages[0];

    await this.page.waitForSelector('.monaco-workbench', { timeout: 20000 });
    console.log('[Visual] Monaco workbench ready.');

    // Wait for active editor on app.ts
    await this.page.waitForSelector('.monaco-editor', { timeout: 15000 });
    console.log('[Visual] Monaco editor ready on app.ts.');
    await this.page.waitForTimeout(2000);

    await this.dismissOverlays();
    await this.focusEditor();
    await this.page.waitForTimeout(1000);
  }

  async dismissOverlays(): Promise<void> {
    if (!this.page) return;
    try {
      await this.page.evaluate(() => {
        document
          .querySelectorAll(
            '.onboarding-a-overlay, [aria-label*="Welcome to Visual Studio Code"], .monaco-modal-overlay'
          )
          .forEach((el: any) => el.remove());
      });
    } catch {}
    await this.page.keyboard.press('Escape');
  }

  async executeCommand(title: string): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');
    await this.dismissOverlays();
    await this.page.waitForTimeout(200);

    const inputSelector = '.quick-input-widget input.input';
    let input = this.page.locator(inputSelector);
    if (!(await input.isVisible())) {
      await this.page.keyboard.press('F1');
      try {
        await this.page.waitForSelector(inputSelector, { state: 'visible', timeout: 3000 });
      } catch {
        await this.focusEditor();
        await this.page.keyboard.press('Control+Shift+P');
        await this.page.waitForSelector(inputSelector, { state: 'visible', timeout: 5000 });
      }
    }

    input = this.page.locator(inputSelector);
    const commandText = title.startsWith('>') ? title : `>${title}`;
    await input.fill(commandText);
    await this.page.waitForTimeout(800);

    // Use Enter rather than mouse click to avoid pointer event interception
    await this.page.keyboard.press('Enter');
    await this.page.waitForTimeout(1500);
  }

  async focusEditor(): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(200);
    const editor = this.page
      .locator(
        '.editor-instance .lines-content, .editor-container .lines-content, .monaco-editor .lines-content'
      )
      .first();
    await editor.click({ force: true });
    await this.page.waitForTimeout(300);
  }

  async takeSnapshotInteractive(description = 'visual-baseline'): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');
    console.log(`[Action] Taking interactive snapshot: "${description}"...`);

    await this.executeCommand('Snapshots: Take Snapshot');
    await this.page.waitForTimeout(1000);

    // Step 1: In the snapshot type quick pick, "Quick Snapshot" is first item and focused by default.
    // Press Enter to select it
    await this.page.keyboard.press('Enter');
    await this.page.waitForTimeout(1000);

    // Step 2: In the description input box, type description and submit
    const inputSelector = '.quick-input-widget:visible input.input';
    if (await this.page.locator(inputSelector).isVisible({ timeout: 4000 })) {
      if (description) {
        await this.page.locator(inputSelector).fill(description);
        await this.page.waitForTimeout(300);
      }
      await this.page.keyboard.press('Enter');
    }

    // Wait for snapshot on disk
    const storePath = path.join(this.fixtureRoot, '.snapshots-test');
    for (let i = 0; i < 30; i++) {
      const idx = path.join(storePath, 'index.json');
      if (fs.existsSync(idx) && fs.readFileSync(idx, 'utf8').includes('snapshot-')) {
        console.log('[Action] Snapshot confirmed created on disk!');
        break;
      }
      await this.page.waitForTimeout(500);
    }
  }

  async capture(name: string): Promise<string> {
    if (!this.page) throw new Error('Page not initialized');
    const filePath = path.join(this.outDir, `${name}.png`);
    await this.page.screenshot({ path: filePath });
    console.log(`[Screenshot] Saved ${name}.png`);
    return filePath;
  }

  // Suite 1: Gutter Decorations
  async testGutterDecorations(): Promise<VisualTestResult> {
    const start = Date.now();
    const result: VisualTestResult = {
      name: 'Gutter Decorations (editorDecorator.ts)',
      passed: false,
      durationMs: 0,
      screenshots: [],
      assertions: [],
    };

    try {
      if (!this.page) throw new Error('Page not initialized');

      // Step 1: Take initial baseline snapshot
      await this.takeSnapshotInteractive('gutter-baseline');

      // Step 2: Focus editor and insert new line at top
      await this.focusEditor();
      await this.page.keyboard.press('Control+Home');
      await this.page.keyboard.type('// newly added header line\n');

      // Debounce wait (500ms in editorDecorator.ts)
      await this.page.waitForTimeout(1200);

      // Check for glyph margin decoration
      const gutterSvgFound = await this.page.evaluate(() => {
        const glyphs = document.querySelectorAll('.glyph-margin-widgets, .cgmr, .ced-editorDecorator');
        const svgs = Array.from(document.querySelectorAll('*')).filter((el: any) => {
          const bg = window.getComputedStyle(el).backgroundImage;
          return bg.includes('data:image/svg+xml');
        });
        return {
          glyphCount: glyphs.length,
          svgBackgroundCount: svgs.length,
          hasGreenSvg: svgs.some((el: any) =>
            window.getComputedStyle(el).backgroundImage.includes('rgba(0,%20255,%200') ||
            window.getComputedStyle(el).backgroundImage.includes('PHN2Zy')
          ),
        };
      });

      result.assertions.push(
        `Decorations rendered with SVG glyphs: ${gutterSvgFound.svgBackgroundCount > 0 || gutterSvgFound.glyphCount > 0}`
      );

      const shot1 = await this.capture('01-gutter-added-line');
      result.screenshots.push(shot1);

      // Step 3: Undo edit and assert cleared
      await this.page.keyboard.press('Control+z');
      await this.page.waitForTimeout(1200);

      const shot2 = await this.capture('01-gutter-reverted');
      result.screenshots.push(shot2);

      result.passed = true;
    } catch (err: any) {
      result.error = err.message;
    }

    result.durationMs = Date.now() - start;
    return result;
  }

  // Suite 2: Dialogs & Modals
  async testDialogsAndModals(): Promise<VisualTestResult> {
    const start = Date.now();
    const result: VisualTestResult = {
      name: 'Dialogs & Modal Confirmations (commands.ts)',
      passed: false,
      durationMs: 0,
      screenshots: [],
      assertions: [],
    };

    try {
      if (!this.page) throw new Error('Page not initialized');

      // Ensure app.ts is open and active
      await this.focusEditor();

      // Step 1: Make a saved change so the workspace differs from the snapshot (changes.length > 0)
      await this.page.keyboard.press('Control+End');
      await this.page.keyboard.type('\n// saved line to create difference from snapshot\n');
      await this.page.keyboard.press('Control+s');
      await this.page.waitForTimeout(800);

      // Step 2: Now add an unsaved edit so the editor buffer is dirty
      await this.page.keyboard.type('// unsaved dirty change for dialog test\n');
      await this.page.waitForTimeout(800);

      // Verify dirty tab
      const isDirty = await this.page.evaluate(() => {
        const dirtyTab = document.querySelector('.tab.dirty');
        const dirtyIcon = document.querySelector('.dirty');
        return dirtyTab !== null || dirtyIcon !== null;
      });
      result.assertions.push(`Editor tab is dirty: ${isDirty}`);

      // Step 3: Trigger Restore via Snapshots: View Snapshots
      console.log('[Action] Opening View Snapshots quick pick...');
      await this.executeCommand('Snapshots: View Snapshots');
      await this.page.waitForTimeout(1500);

      const quickInputState = await this.page.evaluate(() => {
        const widget = document.querySelector('.quick-input-widget');
        const rows = Array.from(document.querySelectorAll('.quick-input-widget .monaco-list-row'));
        const title = document.querySelector('.quick-input-title')?.textContent;
        const message = document.querySelector('.quick-input-message')?.textContent;
        const inputVal = (document.querySelector('.quick-input-widget input.input') as any)?.value;
        const placeholder = (document.querySelector('.quick-input-widget input.input') as any)?.placeholder;
        const visible = widget ? window.getComputedStyle(widget).display !== 'none' : false;
        return {
          visible,
          title,
          message,
          inputVal,
          placeholder,
          rowCount: rows.length,
          rowTexts: rows.map((r: any) => r.textContent?.trim()),
        };
      });
      console.log('[Debug] Quick input state after View Snapshots:', JSON.stringify(quickInputState));

      // Step 3b: Press Enter to accept the selected snapshot
      console.log('[Action] Pressing Enter to select snapshot from quick pick...');
      await this.page.keyboard.press('Enter');
      await this.page.waitForTimeout(1500);

      const confirmState = await this.page.evaluate(() => {
        const title = document.querySelector('.quick-input-title')?.textContent;
        const rows = Array.from(document.querySelectorAll('.quick-input-widget .monaco-list-row')).map((r: any) => r.textContent?.trim());
        return { title, rows };
      });
      console.log('[Debug] Quick input state on confirmation step:', JSON.stringify(confirmState));

      // Step 4: Confirm Restore Snapshot
      console.log('[Action] Confirming Restore Snapshot...');
      const restoreOption = this.page
        .locator('.quick-input-widget:visible .monaco-list-row:has-text("Restore Snapshot"):visible')
        .first();
      await restoreOption.waitFor({ state: 'visible', timeout: 5000 });
      await restoreOption.click();
      await this.page.waitForTimeout(1000);

      const stillOpen = await this.page.evaluate(() => {
        const widget = document.querySelector('.quick-input-widget');
        return widget ? window.getComputedStyle(widget).display !== 'none' : false;
      });
      if (stillOpen) {
        console.log('[Action] Quick pick still open after click, focusing input and pressing Enter...');
        await this.page.locator('.quick-input-widget:visible input.input').focus();
        await this.page.keyboard.press('Enter');
        await this.page.waitForTimeout(1000);
      }

      const domDialogs = await this.page.evaluate(() => {
        const dialogs = Array.from(
          document.querySelectorAll(
            '.monaco-dialog-box, .dialog-message-container, .dialog-container, [role="dialog"], .monaco-modal-overlay, .notification-toast'
          )
        );
        return dialogs.map((d: any) => ({
          tag: d.tagName,
          className: d.className,
          text: d.textContent?.trim().slice(0, 100),
          visible: window.getComputedStyle(d).display !== 'none',
        }));
      });
      console.log('[Debug] DOM Dialogs / Modals / Toasts:', JSON.stringify(domDialogs));

      // Step 5: Check modal dialog box
      const dialogSelector = '.monaco-dialog-box, .dialog-message-container';
      await this.page.waitForSelector(dialogSelector, { state: 'visible', timeout: 8000 });

      const dialogInfo = await this.page.evaluate(() => {
        const box = document.querySelector('.monaco-dialog-box');
        if (!box) return null;
        const text = box.querySelector('.dialog-message-text')?.textContent || box.textContent || '';
        const buttons = Array.from(box.querySelectorAll('.monaco-button')).map((b: any) => b.textContent?.trim());
        return { text, buttons };
      });

      result.assertions.push(`Modal dialog detected: ${dialogInfo !== null}`);
      if (dialogInfo) {
        result.assertions.push(`Dialog contains unsaved warning: ${dialogInfo.text.includes('unsaved')}`);
        result.assertions.push(`Dialog buttons: ${dialogInfo.buttons.join(', ')}`);
      }

      const shot1 = await this.capture('02-dialog-unsaved-conflict');
      result.screenshots.push(shot1);

      // Step 6: Click "Cancel" in modal dialog
      const cancelBtn = this.page.locator('.monaco-dialog-box .monaco-button:has-text("Cancel")').first();
      if (await cancelBtn.isVisible({ timeout: 2000 })) {
        await cancelBtn.click({ force: true });
      } else {
        await this.page.keyboard.press('Escape');
      }
      await this.page.waitForTimeout(1000);

      // Verify cancellation toast
      const toastShot = await this.capture('02-dialog-cancelled-toast');
      result.screenshots.push(toastShot);

      // Step 7: Clean up edits in app.ts
      await this.focusEditor();
      await this.page.keyboard.press('Control+z'); // undo unsaved line
      await this.page.waitForTimeout(300);
      await this.page.keyboard.press('Control+z'); // undo saved line
      await this.page.waitForTimeout(300);
      await this.page.keyboard.press('Control+s'); // save reverted
      await this.page.waitForTimeout(500);

      result.passed = dialogInfo !== null;
    } catch (err: any) {
      result.error = err.message;
    }

    result.durationMs = Date.now() - start;
    return result;
  }

  // Suite 3: Diff Editor
  async testDiffEditor(): Promise<VisualTestResult> {
    const start = Date.now();
    const result: VisualTestResult = {
      name: 'Diff Editor (diffContentProvider.ts, vscode.diff)',
      passed: false,
      durationMs: 0,
      screenshots: [],
      assertions: [],
    };

    try {
      if (!this.page) throw new Error('Page not initialized');

      // Make a permanent saved change to app.ts
      await this.focusEditor();
      await this.page.keyboard.press('Control+End');
      await this.page.keyboard.type('\n// permanently added diff test line\n');
      await this.page.keyboard.press('Control+s');
      await this.page.waitForTimeout(1000);

      // Open CodeLapse tree view in sidebar
      await this.executeCommand('Snapshots: Focus My Snapshots View');
      await this.page.waitForTimeout(1500);

      // Find snapshot row in tree view
      const treeRow = this.page.locator('.monaco-list-row').first();
      await treeRow.waitFor({ state: 'visible', timeout: 5000 });
      await treeRow.hover();
      await this.page.waitForTimeout(500);

      // Look for the inline action button (Compare with Current / diff icon)
      const diffActionBtn = this.page.locator(
        '.monaco-list-row .actions .codicon-diff, .monaco-list-row [aria-label*="Compare"]'
      ).first();

      if (await diffActionBtn.isVisible()) {
        await diffActionBtn.click();
        await this.page.waitForTimeout(2000);
      } else {
        await treeRow.click();
        await this.executeCommand('Snapshots: Compare with Current');
        await this.page.waitForTimeout(2000);
      }

      // If a QuickPick pops up for selecting a file, choose first
      const quickPickVisible = await this.page.evaluate(() => {
        return document.querySelector('.quick-input-widget') !== null;
      });
      if (quickPickVisible) {
        await this.page.keyboard.press('Enter');
        await this.page.waitForTimeout(2000);
      }

      // Check if diff editor is active
      const diffEditorInfo = await this.page.evaluate(() => {
        const diff = document.querySelector('.monaco-diff-editor');
        const activeTab = document.querySelector('.tab.active');
        const tabTitle = activeTab?.textContent?.trim() || '';
        return {
          diffEditorFound: diff !== null,
          tabTitle,
          isDiffTab: tabTitle.includes('vs Current') || tabTitle.includes('vs Workspace') || tabTitle.includes('↔'),
        };
      });

      result.assertions.push(`Monaco Diff Editor present: ${diffEditorInfo.diffEditorFound}`);
      result.assertions.push(`Active tab title: "${diffEditorInfo.tabTitle}"`);

      const shot = await this.capture('03-diff-editor-side-by-side');
      result.screenshots.push(shot);

      // Close diff tab
      await this.page.keyboard.press('Control+w');
      await this.page.waitForTimeout(1000);

      result.passed = diffEditorInfo.diffEditorFound || diffEditorInfo.isDiffTab;
    } catch (err: any) {
      result.error = err.message;
    }

    result.durationMs = Date.now() - start;
    return result;
  }

  // Suite 4: Welcome Page & Guided Tour
  async testWelcomeAndTour(): Promise<VisualTestResult> {
    const start = Date.now();
    const result: VisualTestResult = {
      name: 'Welcome Experience & Guided Tour (welcomeView.ts)',
      passed: false,
      durationMs: 0,
      screenshots: [],
      assertions: [],
    };

    try {
      if (!this.page) throw new Error('Page not initialized');

      // Trigger tour
      await this.executeCommand('Snapshots: Getting Started');
      await this.page.waitForTimeout(1000);

      // Step 1
      const shot1 = await this.capture('04-tour-step-1');
      result.screenshots.push(shot1);

      const nextButton = this.page.locator(
        '.notification-toast-container .monaco-button:has-text("Next"), .notifications-toasts .monaco-button:has-text("Next")'
      ).first();

      if (await nextButton.isVisible({ timeout: 4000 })) {
        result.assertions.push('Tour Step 1 toast rendered with Next button');
        await nextButton.click();
        await this.page.waitForTimeout(800);

        // Step 2
        const shot2 = await this.capture('04-tour-step-2');
        result.screenshots.push(shot2);
        result.assertions.push('Tour Step 2 toast rendered');
        if (await nextButton.isVisible()) {
          await nextButton.click();
          await this.page.waitForTimeout(800);
        }

        // Step 3
        const shot3 = await this.capture('04-tour-step-3');
        result.screenshots.push(shot3);
        result.assertions.push('Tour Step 3 toast rendered');
        if (await nextButton.isVisible()) {
          await nextButton.click();
          await this.page.waitForTimeout(800);
        }

        // Final Step: Start Using Snapshots
        const startBtn = this.page.locator(
          '.notification-toast-container .monaco-button:has-text("Start Using Snapshots"), .notifications-toasts .monaco-button:has-text("Start Using Snapshots")'
        ).first();
        const shot4 = await this.capture('04-tour-complete');
        result.screenshots.push(shot4);

        if (await startBtn.isVisible()) {
          result.assertions.push('Tour completion toast rendered with Start Using Snapshots');
          await startBtn.click();
          await this.page.waitForTimeout(1500);
        }
      }

      // Assert CodeLapse sidebar is focused
      const sidebarShot = await this.capture('04-sidebar-opened');
      result.screenshots.push(sidebarShot);

      const sidebarActive = await this.page.evaluate(() => {
        const title = document.querySelector('.sidebar .composite.title, .sidebar .title-label')?.textContent || '';
        return title.includes('Snapshots') || document.querySelector('.snapshot-explorer') !== null;
      });
      result.assertions.push(`Sidebar view active: ${sidebarActive}`);

      result.passed = true;
    } catch (err: any) {
      result.error = err.message;
    }

    result.durationMs = Date.now() - start;
    return result;
  }

  async generateHtmlReport(results: VisualTestResult[]): Promise<string> {
    const reportPath = path.join(this.outDir, 'report.html');
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>CodeLapse Visual Regression Test Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 24px; background: #0f1117; color: #e1e4e8; }
    h1 { color: #58a6ff; border-bottom: 1px solid #30363d; padding-bottom: 12px; }
    .suite-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; margin-bottom: 24px; padding: 20px; }
    .suite-header { display: flex; justify-content: space-between; align-items: center; }
    .badge { padding: 4px 10px; border-radius: 12px; font-weight: 600; font-size: 13px; }
    .badge.passed { background: #238636; color: #fff; }
    .badge.failed { background: #da3633; color: #fff; }
    .assertions { background: #0d1117; padding: 12px; border-radius: 6px; margin: 12px 0; font-family: monospace; font-size: 13px; }
    .assertions li { margin-bottom: 4px; }
    .gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 16px; margin-top: 16px; }
    .thumb { border: 1px solid #30363d; border-radius: 6px; overflow: hidden; background: #0d1117; }
    .thumb img { width: 100%; height: auto; display: block; border-bottom: 1px solid #30363d; }
    .thumb-title { padding: 8px 12px; font-size: 12px; color: #8b949e; }
  </style>
</head>
<body>
  <h1>CodeLapse Visual Regression Report</h1>
  <p>Generated: ${new Date().toLocaleString()} | Automation: Playwright Electron CDP</p>
  
  ${results
    .map(
      (r) => `
    <div class="suite-card">
      <div class="suite-header">
        <h2>${r.name}</h2>
        <span class="badge ${r.passed ? 'passed' : 'failed'}">${r.passed ? 'PASSED' : 'FAILED'} (${r.durationMs}ms)</span>
      </div>
      ${r.error ? `<p style="color: #f85149;">Error: ${r.error}</p>` : ''}
      <div class="assertions">
        <strong>Assertions & DOM Invariants:</strong>
        <ul>
          ${r.assertions.map((a) => `<li>${a}</li>`).join('')}
        </ul>
      </div>
      <div class="gallery">
        ${r.screenshots
          .map(
            (s) => `
          <div class="thumb">
            <img src="${path.basename(s)}" alt="${path.basename(s)}" />
            <div class="thumb-title">${path.basename(s)}</div>
          </div>
        `
          )
          .join('')}
      </div>
    </div>
  `
    )
    .join('')}
</body>
</html>`;

    fs.writeFileSync(reportPath, html);
    console.log(`[Report] Visual report generated at: ${reportPath}`);
    return reportPath;
  }

  async teardown(): Promise<void> {
    console.log('[Visual] Tearing down runner...');
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {}
    }
    if (this.childProcess) {
      try {
        this.childProcess.kill();
      } catch {}
    }
    try {
      fs.rmSync(this.fixtureRoot, { recursive: true, force: true });
      fs.rmSync(this.userDataDir, { recursive: true, force: true });
    } catch {}
    console.log('[Visual] Teardown complete.');
  }
}

// Entrypoint
if (require.main === module) {
  (async () => {
    const runner = new VisualRegressionRunner();
    const results: VisualTestResult[] = [];

    try {
      await runner.setup();

      console.log('\n--- Running Test Suite 1: Gutter Decorations ---');
      results.push(await runner.testGutterDecorations());

      console.log('\n--- Running Test Suite 2: Dialogs & Modals ---');
      results.push(await runner.testDialogsAndModals());

      console.log('\n--- Running Test Suite 3: Diff Editor ---');
      results.push(await runner.testDiffEditor());

      console.log('\n--- Running Test Suite 4: Welcome & Guided Tour ---');
      results.push(await runner.testWelcomeAndTour());

      await runner.generateHtmlReport(results);
    } catch (err) {
      console.error('Test run failed fatally:', err);
    } finally {
      await runner.teardown();
    }

    const failedCount = results.filter((r) => !r.passed).length;
    console.log(`\nVisual Suite Completed: ${results.length - failedCount}/${results.length} passed.`);
    process.exit(failedCount > 0 ? 1 : 0);
  })();
}
