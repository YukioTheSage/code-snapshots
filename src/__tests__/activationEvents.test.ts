import * as fs from 'fs';
import * as path from 'path';

interface Manifest {
  engines: { vscode: string };
  activationEvents: string[];
  contributes: {
    commands: Array<{ command: string }>;
    configuration: { properties: Record<string, unknown> };
  };
}

function readManifest(): Manifest {
  const manifestPath = path.join(__dirname, '..', '..', 'package.json');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Manifest;
}

describe('extension manifest', () => {
  it('activates at startup so background services run', () => {
    const events = readManifest().activationEvents;
    expect(events).toContain('onStartupFinished');
  });

  it('keeps the API activation event for external callers', () => {
    const events = readManifest().activationEvents;
    expect(events).toContain('onCommand:vscode-snapshots.getApi');
  });

  it('declares an engine floor of at least 1.80', () => {
    const major = Number(
      readManifest().engines.vscode.replace('^', '').split('.')[1],
    );
    expect(major).toBeGreaterThanOrEqual(80);
  });

  /**
   * The manifest is the contract, so these guard the declarations the runtime
   * actually reads. A missing activation event is invisible in code review --
   * the code is correct and simply never runs -- which is exactly how the IPC
   * bridge, the auto-snapshot timer and the welcome experience all stayed dead.
   */
  it('namespaces every contributed command', () => {
    const manifest = readManifest();
    const declared = new Set(
      manifest.contributes.commands.map((c) => c.command),
    );

    // This asserts the namespace only. That every contributed command is
    // actually registered -- which this test's former name claimed -- is
    // checked by manifestConsistency.test.ts, because this one never did.
    expect(declared.size).toBeGreaterThan(0);
    for (const command of declared) {
      expect(command).toMatch(/^vscode-snapshots\./);
    }
  });

  it('declares the settings the runtime reads by name', () => {
    const properties = readManifest().contributes.configuration.properties;
    const keys = Object.keys(properties);

    // Read by `extension.ts` when gating the shortcut hint.
    expect(keys).toContain('vscode-snapshots.ux.showKeyboardShortcutHints');
    // Read by `getMaxSnapshots()`; the pruning guard depends on it.
    expect(keys).toContain('vscode-snapshots.maxSnapshots');
  });
});
