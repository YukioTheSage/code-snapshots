/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * What `snapshot restore` and `snapshot delete` actually put on the socket.
 *
 * `UnifiedClient.callApi` is a front door: it normalises a payload and hands it
 * to a typed method, which serialises it for the wire. That second step is
 * where the options were lost -- restore spread `options` across the top level
 * of `data`, which the extension never reads (`data.options`,
 * `cliConnectorService.ts`), and delete sent only `{ id }`.
 *
 * `snapshotDeleteConfirm.test.ts` mocks `UnifiedClient`, so it pins the command
 * layer and cannot see either loss. These tests use a real client and replace
 * only its IPC transport -- the constructor offers no seam for that, so the
 * private field is set with a cast -- and assert on the object the socket would
 * carry.
 */
import { UnifiedClient } from '../unifiedClient';

describe('snapshot option payloads on the wire', () => {
  let client: UnifiedClient;
  let ipcCallApi: jest.Mock;

  beforeEach(() => {
    client = new UnifiedClient();
    ipcCallApi = jest.fn().mockResolvedValue({ success: true });
    (client as any).ipcClient = {
      callApi: ipcCallApi,
      getStatus: jest.fn(),
      isConnected: jest.fn(() => true),
    };
    (client as any).activeMode = 'ipc';
  });

  it('sends the delete flags at the top level of data', async () => {
    await client.callApi('deleteSnapshot', {
      id: 'snapshot-1',
      skipConfirm: true,
      force: true,
    });

    expect(ipcCallApi).toHaveBeenCalledWith('deleteSnapshot', {
      id: 'snapshot-1',
      skipConfirm: true,
      force: true,
    });
  });

  it('sends restore options nested under data.options', async () => {
    const options = {
      createBackupSnapshot: true,
      selectedFiles: ['a.ts'],
      skipConfirm: true,
    };

    await client.callApi('restoreSnapshot', { id: 'snapshot-1', options });

    expect(ipcCallApi).toHaveBeenCalledWith('restoreSnapshot', {
      id: 'snapshot-1',
      options,
    });
  });

  it('serialises both delete flags in the typed method', async () => {
    await client.deleteSnapshot('snapshot-1', {
      skipConfirm: true,
      force: true,
    });

    expect(ipcCallApi).toHaveBeenCalledWith('deleteSnapshot', {
      id: 'snapshot-1',
      skipConfirm: true,
      force: true,
    });
  });

  it('always sends both delete flags, even without options', async () => {
    await client.deleteSnapshot('snapshot-1');

    expect(ipcCallApi).toHaveBeenCalledWith('deleteSnapshot', {
      id: 'snapshot-1',
      skipConfirm: false,
      force: false,
    });
  });

  it('keeps restore options nested in the typed method', async () => {
    const options = { createBackupSnapshot: true, selectedFiles: ['a.ts'] };

    await client.restoreSnapshot('snapshot-1', options);

    expect(ipcCallApi).toHaveBeenCalledWith('restoreSnapshot', {
      id: 'snapshot-1',
      options,
    });
  });

  it('forwards the delete flags from the standalone switch, not just the id', async () => {
    (client as any).activeMode = 'standalone';
    (client as any).standaloneHandler = {};
    const deleteSnapshot = jest
      .spyOn(client, 'deleteSnapshot')
      .mockResolvedValue(undefined);

    await client.callApi('deleteSnapshot', {
      id: 'snapshot-1',
      skipConfirm: true,
      force: true,
    });

    expect(deleteSnapshot).toHaveBeenCalledWith('snapshot-1', {
      id: 'snapshot-1',
      skipConfirm: true,
      force: true,
    });
  });

  it('does not wrap a bare id in an options object', async () => {
    (client as any).activeMode = 'standalone';
    (client as any).standaloneHandler = {};
    const deleteSnapshot = jest
      .spyOn(client, 'deleteSnapshot')
      .mockResolvedValue(undefined);

    await client.callApi('deleteSnapshot', 'snapshot-1' as any);

    expect(deleteSnapshot).toHaveBeenCalledTimes(1);
    expect(deleteSnapshot.mock.calls[0][0]).toBe('snapshot-1');
    expect(deleteSnapshot.mock.calls[0][1]).toBeUndefined();
  });
});
