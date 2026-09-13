import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { UnifiedClient, STANDALONE_METHODS } from '../unifiedClient';
import { useRealFileSystem } from './realFs';

jest.mock('../client');

describe('per-method IPC fallback', () => {
  let root: string;
  let client: UnifiedClient;
  let ipcCallApi: jest.Mock;

  beforeEach(async () => {
    useRealFileSystem();
    // A project directory: standalone initialises happily here, which is
    // exactly the situation the fallback exists for.
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-fallback-'));
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"probe"}');

    client = new UnifiedClient('auto', false, 50);
    ipcCallApi = jest.fn().mockResolvedValue({ snapshots: [], totalCount: 0 });
    (client as any).ipcClient = { callApi: ipcCallApi, getStatus: jest.fn() };
    (client as any).activeMode = 'standalone';
    (client as any).standaloneHandler = {};
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('declares a standalone method set that excludes the IPC-only methods', () => {
    expect(STANDALONE_METHODS.has('takeSnapshot')).toBe(true);
    expect(STANDALONE_METHODS.has('getConfig')).toBe(true);
    expect(STANDALONE_METHODS.has('filterSnapshots')).toBe(true);
    expect(STANDALONE_METHODS.has('searchSnapshots')).toBe(false);
    expect(STANDALONE_METHODS.has('runDiagnostics')).toBe(true);
    expect(STANDALONE_METHODS.has('autoSnapshotBeforeGitOperation')).toBe(true);
    expect(STANDALONE_METHODS.has('compareSnapshotWithGitCommit')).toBe(true);
  });

  it('routes an unsupported method over IPC instead of failing', async () => {
    jest.spyOn(process, 'cwd').mockReturnValue(root);

    const result = await client.callApi('searchSnapshots', { query: 'parser' });

    expect(ipcCallApi).toHaveBeenCalledWith('searchSnapshots', {
      query: 'parser',
    });
    expect(result).toEqual({ snapshots: [], totalCount: 0 });
  });

  it('names the reason when neither mode can serve the method', async () => {
    ipcCallApi.mockRejectedValue(new Error('IPC mode not available'));

    await expect(client.callApi('searchSnapshots', {})).rejects.toThrow(
      /no CodeLapse extension answered over IPC/i,
    );
  });

  it('still dispatches standalone-supported methods locally', async () => {
    const spy = jest
      .spyOn(client as any, 'getSnapshots')
      .mockResolvedValue([{ id: 'snapshot-1' }]);

    await client.callApi('getSnapshots', {});

    expect(spy).toHaveBeenCalled();
    expect(ipcCallApi).not.toHaveBeenCalled();
  });

  it('refuses to watch events in standalone mode instead of exiting silently', async () => {
    await expect(
      client.watchEvents(['snapshotCreated'], jest.fn()),
    ).rejects.toThrow(/requires the CodeLapse extension over IPC/i);
  });

  it('dispatches the two git methods locally instead of over IPC', async () => {
    const autoSnapshotBeforeGitOperation = jest
      .fn()
      .mockResolvedValue({ snapshot: { id: 'snapshot-1', description: 'd' } });
    const compareSnapshotWithGitCommit = jest
      .fn()
      .mockResolvedValue({ differences: [] });
    (client as any).standaloneHandler = {
      autoSnapshotBeforeGitOperation,
      compareSnapshotWithGitCommit,
    };

    await expect(
      client.callApi('autoSnapshotBeforeGitOperation', { operation: 'pull' }),
    ).resolves.toEqual({ snapshot: { id: 'snapshot-1', description: 'd' } });
    await expect(
      client.callApi('compareSnapshotWithGitCommit', {
        snapshotId: 'snapshot-1',
        commitHash: 'abc1234',
      }),
    ).resolves.toEqual({ differences: [] });

    expect(autoSnapshotBeforeGitOperation).toHaveBeenCalledWith({
      operation: 'pull',
    });
    expect(compareSnapshotWithGitCommit).toHaveBeenCalledWith({
      snapshotId: 'snapshot-1',
      commitHash: 'abc1234',
    });
    expect(ipcCallApi).not.toHaveBeenCalled();
  });
});
