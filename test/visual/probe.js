const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright-core');

async function testConnection() {
  const codeExe = path.join(
    __dirname,
    '../../.vscode-test/vscode-win32-x64-archive-1.137.0/Code.exe'
  );
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-visual-'));
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-user-'));
  fs.mkdirSync(path.join(fixtureRoot, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(fixtureRoot, 'src', 'app.ts'),
    "console.log('hello visual test');\n"
  );

  const port = 9333;
  const args = [
    `--remote-debugging-port=${port}`,
    '--disable-extensions',
    `--extensionDevelopmentPath=${path.resolve(__dirname, '../..')}`,
    '--disable-workspace-trust',
    '--disable-gpu',
    `--user-data-dir=${userDataDir}`,
    fixtureRoot,
  ];

  console.log('Spawning Code.exe...');
  const child = cp.spawn(codeExe, args, {
    stdio: 'ignore',
    windowsHide: false,
  });

  try {
    // Wait for CDP endpoint to respond
    console.log(`Waiting for CDP on port ${port}...`);
    let connected = false;
    let browser = null;
    for (let i = 0; i < 30; i++) {
      try {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
        connected = true;
        break;
      } catch (e) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    if (!connected || !browser) {
      throw new Error('Could not connect to VS Code via CDP');
    }

    console.log('Connected to VS Code via CDP!');
    const contexts = browser.contexts();
    console.log(`Contexts: ${contexts.length}`);
    const pages = contexts[0].pages();
    console.log(`Pages: ${pages.length}`);
    
    // Find the workbench page
    let workbenchPage = pages.find((p) => p.url().includes('workbench.html')) || pages[0];
    console.log(`Page URL: ${workbenchPage ? workbenchPage.url() : 'none'}`);

    // Wait for workbench to load
    await workbenchPage.waitForSelector('.monaco-workbench', { timeout: 15000 });
    console.log('Monaco workbench loaded!');

    // Take screenshot
    const outDir = path.join(__dirname, '../../test-out/visual-evidence');
    fs.mkdirSync(outDir, { recursive: true });
    const screenshotPath = path.join(outDir, '00-probe-workbench.png');
    await workbenchPage.screenshot({ path: screenshotPath });
    console.log(`Probe screenshot saved to: ${screenshotPath}`);

    await browser.close();
  } finally {
    console.log('Killing Code.exe process...');
    child.kill();
    // Clean up if needed
    try {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {}
  }
}

testConnection()
  .then(() => {
    console.log('Probe finished successfully!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Probe failed:', err);
    process.exit(1);
  });
