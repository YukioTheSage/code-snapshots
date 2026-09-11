/**
 * Regression guard for `snapshot show --files/--content` (BUG-3).
 *
 * The command layer sends `{ snapshotId: id }`, but the standalone dispatch
 * for `getSnapshotChanges` read `payload.id || payload`. With no `id` key the
 * whole payload object was passed down as the snapshot id, so core's
 * validation rejected every `snapshot show <id> --files` with
 * "Invalid snapshot ID: must be a non-empty string" -- for valid ids too.
 */

import { UnifiedClient } from '../unifiedClient';

interface Captured {
  ids: unknown[];
}

function clientWithFakeHandler(): { client: UnifiedClient; captured: Captured } {
  const captured: Captured = { ids: [] };
  const client = new UnifiedClient();

  // Inject the handler and mode directly: the point under test is the payload
  // normalization in callApi, not workspace discovery or IPC fallback.
  (client as unknown as { standaloneHandler: unknown }).standaloneHandler = {
    getSnapshotChanges: async (id: unknown) => {
      captured.ids.push(id);
      return { added: [], modified: [], deleted: [] };
    },
  };
  (client as unknown as { activeMode: string }).activeMode = 'standalone';

  return { client, captured };
}

describe('callApi getSnapshotChanges id normalization (BUG-3)', () => {
  it('accepts the { snapshotId } shape the snapshot commands send', async () => {
    const { client, captured } = clientWithFakeHandler();

    await (client as unknown as {
      callApi: (m: string, d: unknown) => Promise<unknown>;
    }).callApi('getSnapshotChanges', { snapshotId: 'snapshot-x' });

    expect(captured.ids).toEqual(['snapshot-x']);
  });

  it('still accepts the { id } shape used by api callers', async () => {
    const { client, captured } = clientWithFakeHandler();

    await (client as unknown as {
      callApi: (m: string, d: unknown) => Promise<unknown>;
    }).callApi('getSnapshotChanges', { id: 'snapshot-y' });

    expect(captured.ids).toEqual(['snapshot-y']);
  });
});
