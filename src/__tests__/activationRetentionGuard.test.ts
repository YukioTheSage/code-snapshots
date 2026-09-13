import * as fs from 'fs';
import * as path from 'path';
import { enforceStartupRetention } from '../extension';
import { subscribeToLogEntries } from '../logger';
import type { SnapshotManager } from '../snapshotManager';

/* eslint-disable @typescript-eslint/no-explicit-any */

function managerWithRetention(rejection?: Error): SnapshotManager {
  return {
    getStoreDirectory: () => '/ws/.snapshots',
    enforceSnapshotSizeLimitOnActivation: jest.fn(() =>
      rejection
        ? Promise.reject(rejection)
        : Promise.resolve({
            bytesBefore: 0,
            bytesAfter: 0,
            trimmed: [],
            stillOverLimit: false,
          }),
    ),
  } as unknown as SnapshotManager;
}

describe('startup retention guard', () => {
  it('keeps activation running when retention cannot delete a snapshot', async () => {
    const manager = managerWithRetention(
      new Error('EPERM: operation not permitted'),
    );

    await expect(enforceStartupRetention(manager)).resolves.toBeUndefined();

    expect(manager.enforceSnapshotSizeLimitOnActivation).toHaveBeenCalledTimes(
      1,
    );
  });

  it('reports which store failed and why', async () => {
    const manager = managerWithRetention(
      new Error('EPERM: operation not permitted'),
    );
    const messages: string[] = [];
    const unsubscribe = subscribeToLogEntries((entry) =>
      messages.push(entry.message),
    );

    try {
      await enforceStartupRetention(manager);
    } finally {
      unsubscribe();
    }

    // Best-effort, but not silent: an operator has to be able to tell which
    // store could not be pruned and why.
    expect(
      messages.some(
        (message) =>
          message.includes('/ws/.snapshots') &&
          message.includes('EPERM: operation not permitted'),
      ),
    ).toBe(true);
  });

  it('goes through the guard in activate', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'extension.ts'),
      'utf8',
    );
    // The guard is only worth anything if activation reaches retention
    // through it rather than calling the entry point directly.
    expect(source).toMatch(/await enforceStartupRetention\(snapshotManager\)/);
  });
});
