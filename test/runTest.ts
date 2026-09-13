import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as cp from "child_process";
import { downloadAndUnzipVSCode } from "@vscode/test-electron";

function main() {
  (async () => {
    // Build a throwaway workspace fixture so the suite never touches the
    // developer's checkout, and pre-seed workspace settings that suppress every
    // blocking modal (welcome, restore confirmation, shortcut hint, etc.).
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codelapse-it-"));
    fs.mkdirSync(path.join(fixtureRoot, "src"), { recursive: true });
    fs.mkdirSync(path.join(fixtureRoot, ".vscode"), { recursive: true });
    fs.writeFileSync(
      path.join(fixtureRoot, "src", "app.ts"),
      "// fixture file\nconsole.log('hello codelapse');\n",
    );
    fs.writeFileSync(
      path.join(fixtureRoot, ".vscode", "settings.json"),
      JSON.stringify(
        {
          "vscode-snapshots.snapshotLocation": ".snapshots-test",
          "vscode-snapshots.maxSnapshots": 20,
          "vscode-snapshots.ux.showWelcomeOnStartup": false,
          "vscode-snapshots.ux.showKeyboardShortcutHints": false,
          "vscode-snapshots.ux.confirmRestoreOperations": false,
          "vscode-snapshots.git.addCommitInfo": false,
          "vscode-snapshots.git.commitFromSnapshotEnabled": false,
          "vscode-snapshots.semanticSearch.enabled": false,
          "vscode-snapshots.autoSnapshotInterval": 0,
        },
        null,
        2,
      ),
    );

    const extensionDevelopmentPath = path.resolve(__dirname, "..", "..");
    const extensionTestsPath = path.join(__dirname, "suite");
    const manifestPath = path.join(extensionDevelopmentPath, "package.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

    // Download (or reuse) a standalone VS Code build. On Windows the helper
    // returns the path to Code.exe itself; handle the dir-shaped return too.
    const resolved = await downloadAndUnzipVSCode();
    const codeExe = resolved.endsWith(".exe") ? resolved : path.join(resolved, "Code.exe");

    const args = [
      "--disable-extensions",
      "--extensionDevelopmentPath=" + extensionDevelopmentPath,
      "--extensionTestsPath=" + extensionTestsPath,
      "--disable-gpu",
      "--disable-updates",
      "--disable-crash-reporter",
      "--disable-workspace-trust",
      fixtureRoot,
    ];

    const env = {
      ...process.env,
      CODELAPSE_FIXTURE_ROOT: fixtureRoot,
      CODELAPSE_EXPECTED_ID: `YukioTheSage.${manifest.name}`,
      // HEADLESS TEST RUN: the extension host cannot answer input boxes. The
      // credentials prompt would block delete/purge chains forever, so services
      // must fail fast instead of prompting (vscode-snapshots env contract).
      CODELAPSE_DISABLE_CREDENTIAL_PROMPTS: "1",
      // HEADLESS TEST RUN: non-modal pickers (`showQuickPick` / `showInputBox`)
      // HANG here rather than throwing, so any command that awaits one never
      // returns. This is the general switch that makes such prompts no-ops
      // (see src/headless.ts).
      CODELAPSE_DISABLE_INTERACTIVE_UI: "1",
      // Don't inherit an accidentally-set ELECTRON_RUN_AS_NODE, which would
      // make Code.exe start up as plain Node instead of an extension host.
      ELECTRON_RUN_AS_NODE: undefined as any,
    };

    console.log(`Launching VS Code (${codeExe}) to run extension tests...`);
    // stdio 'inherit': sandboxed environments deny spawning children with
    // piped stdio; a pass-through console launch is the supported path.
    const child = cp.spawn(codeExe, args, {
      stdio: "inherit" as const,
      env,
      windowsHide: false,
    });

    const code = await new Promise<number | null>((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (c) => resolve(c));
    });

    if (code !== 0) {
      console.error(`Integration tests failed (exit code ${code}).`);
      process.exitCode = 1;
      return;
    }
    console.log("Integration tests passed.");
  })().catch((err) => {
    console.error("Failed to run integration tests:", err);
    process.exit(1);
  });
}

main();
