/**
 * Regression guard for the CLI's stdout contract in standalone mode.
 *
 * codelapse-core used to send three human notices through console.log:
 * "Cannot load snapshots, storage directory not initialized.", "Snapshot index
 * file not found. Starting with empty state." and the retention trim report.
 * The second one fires on every fresh store -- every first run and every clean
 * CI checkout -- so 'codelapse snapshot list --json | jq' received a prose line
 * ahead of the payload and failed with a JSON parse error. The notices belong
 * on stderr: stdout is the machine-readable channel that --json promises.
 *
 * 'codelapse-core' resolves to shared/dist from this package (its 'main'), and
 * that build lags the source change this suite guards, so the module is mapped
 * to shared/src here: the suite has to exercise the source under test. The
 * mapping is file-scoped; no other cli suite sees it.
 */
jest.mock('codelapse-core', () =>
  jest.requireActual('../../../shared/src/index'),
);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { measureSnapshotStore, SnapshotStorage } from 'codelapse-core';
import { SnapshotCommands } from '../commands/snapshot';
import { StandaloneHandler } from '../standaloneHandler';
import { UnifiedClient } from '../unifiedClient';
import { useRealFileSystem } from './realFs';

const FRESH_STORE_NOTICE =
  'Snapshot index file not found. Starting with empty state.';
const UNINITIALIZED_NOTICE =
  'Cannot load snapshots, storage directory not initialized.';

/**
 * Byte-level capture of both process streams.
 *
 * setup.ts replaces console.log and console.error with jest.fn(), which erases
 * WHICH stream a message would have reached -- the only thing this suite
 * asserts. For the duration of a capture both methods are rebound to Node's own
 * console object, which writes to process.stdout and process.stderr exactly as
 * the runtime does, and those writes are recorded here instead of reaching the
 * terminal.
 */
function captureStreams(): {
  stdout: () => string;
  stderr: () => string;
  restore: () => void;
} {
  const nodeConsole =
    jest.requireActual<Pick<Console, 'log' | 'error'>>('console');
  const mockedLog = console.log;
  const mockedError = console.error;
  let stdout = '';
  let stderr = '';

  const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(((
    chunk: unknown,
  ) => {
    stdout += String(chunk);
    return true;
  }) as never);
  const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(((
    chunk: unknown,
  ) => {
    stderr += String(chunk);
    return true;
  }) as never);

  console.log = nodeConsole.log.bind(nodeConsole);
  console.error = nodeConsole.error.bind(nodeConsole);

  return {
    stdout: () => stdout,
    stderr: () => stderr,
    restore: () => {
      console.log = mockedLog;
      console.error = mockedError;
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    },
  };
}

describe('standalone mode keeps stdout machine-readable', () => {
  let root: string;
  let previousCwd: string;

  beforeEach(() => {
    useRealFileSystem();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-stdout-'));
    fs.writeFileSync(path.join(root, 'package.json'), '{}', 'utf8');
    // Big enough that the retention case below has a snapshot whose bytes
    // clearly exceed the store's excess over its limit.
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'x'.repeat(4000), 'utf8');
    previousCwd = process.cwd();
    process.chdir(root);
  });

  afterEach(() => {
    process.chdir(previousCwd);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('emits only the payload for `snapshot list --json` on an empty store', async () => {
    const capture = captureStreams();
    let output: string;
    try {
      const client = new UnifiedClient();
      await client.initialize();
      await new SnapshotCommands(client).list({ json: true });
      output = capture.stdout();
    } finally {
      capture.restore();
    }

    // Exactly what the pipe receives, so this is what jq parses.
    const payload = JSON.parse(output) as {
      success: boolean;
      snapshots: unknown[];
      total: number;
    };
    expect(payload).toEqual({ success: true, snapshots: [], total: 0 });
    expect(output.trim().split('\n')).toHaveLength(1);
    expect(capture.stderr()).toContain(FRESH_STORE_NOTICE);
  });

  it('keeps the retention trim report off stdout when a take trims the store', async () => {
    const handler = new StandaloneHandler();
    expect(await handler.initialize()).toBe(true);
    await handler.takeSnapshot({ description: 'first' });

    // One byte under the size the store reached with that snapshot, so the
    // next take's own bytes push it over and the trim runs -- which is what
    // reports. The excess is far smaller than the older snapshot's bytes,
    // which the all-or-nothing candidate selection requires before it is
    // allowed to remove anything.
    const before = measureSnapshotStore(path.join(root, '.snapshots'));
    const limitBytes = before.totalBytes - 1;
    fs.mkdirSync(path.join(root, '.vscode'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.vscode', 'codelapse.json'),
      JSON.stringify(
        { maxSnapshots: 50, maxSnapshotStoreBytes: limitBytes },
        null,
        2,
      ),
      'utf8',
    );
    // The manager holds its own ConfigManager instance (the handler has a
    // second one), and it caches the file it read before the write above, so
    // the limit only takes effect once that instance is told to reload.
    (
      handler as unknown as {
        snapshotManager: { config: { clearCache(): void } };
      }
    ).snapshotManager.config.clearCache();

    const capture = captureStreams();
    let stdout: string;
    let stderr: string;
    try {
      await handler.takeSnapshot({ description: 'second' });
      stdout = capture.stdout();
      stderr = capture.stderr();
    } finally {
      capture.restore();
    }

    expect(stderr).toContain('Retention: trimmed 1 snapshot(s)');
    expect(stdout).toBe('');
  });

  it('sends the uninitialized-storage notice to stderr as well', async () => {
    const storage = new SnapshotStorage(root);
    // That guard is defensive -- the constructor always sets a directory -- so
    // the notice is pinned here directly instead of through a public path.
    (storage as unknown as { snapshotDirectory: string }).snapshotDirectory =
      '';

    const capture = captureStreams();
    let stdout: string;
    let stderr: string;
    try {
      await storage.loadSnapshotIndexAndMetadata();
      stdout = capture.stdout();
      stderr = capture.stderr();
    } finally {
      capture.restore();
    }

    expect(stderr).toContain(UNINITIALIZED_NOTICE);
    expect(stdout).toBe('');
  });
});
