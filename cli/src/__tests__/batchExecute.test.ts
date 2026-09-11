import { batchExecute } from '../commands/batch';
import type { UnifiedClient } from '../unifiedClient';

function clientDouble(
  handler: (method: string, data: unknown) => Promise<unknown>,
): UnifiedClient {
  return { callApi: jest.fn(handler) } as unknown as UnifiedClient;
}

describe('batchExecute', () => {
  it('runs each command through callApi, in order', async () => {
    const calls: string[] = [];
    const client = clientDouble(async (method) => {
      calls.push(method);
      return { success: true };
    });

    const results = await batchExecute(
      [
        { method: 'takeSnapshot', data: { description: 'a' } },
        { method: 'getSnapshots' },
      ],
      client,
    );

    expect(calls).toEqual(['takeSnapshot', 'getSnapshots']);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);
  });

  it('rejects a method that is not on the allowlist', async () => {
    // The validator existed for exactly this and had no callers, so an arbitrary
    // method name previously reached the client.
    const client = clientDouble(async () => ({ success: true }));

    await expect(
      batchExecute([{ method: 'rm -rf /' }], client),
    ).rejects.toThrow(/not allowed/i);
  });

  it('rejects a payload that is not an array', async () => {
    const client = clientDouble(async () => ({ success: true }));
    await expect(batchExecute({ method: 'getStatus' }, client)).rejects.toThrow(
      /array/i,
    );
  });

  it('rejects an entry with no method', async () => {
    const client = clientDouble(async () => ({ success: true }));
    await expect(batchExecute([{ data: {} }], client)).rejects.toThrow(
      /method/i,
    );
  });

  it('records a rejecting call as a failed entry without aborting the batch', async () => {
    const client = clientDouble(async (method) => {
      if (method === 'getSnapshot') {
        throw new Error('Snapshot not found');
      }
      return { success: true };
    });

    const results = await batchExecute(
      [
        { method: 'getSnapshot', data: { id: 'nope' } },
        { method: 'getStatus' },
      ],
      client,
    );

    expect(results[0].success).toBe(false);
    expect(results[0].error).toMatch(/Snapshot not found/);
    // The batch continues: one bad command must not hide the rest.
    expect(results[1].success).toBe(true);
    expect(results).toHaveLength(2);
  });

  it('treats a resolved payload with success false as a failed entry', async () => {
    // The transport worked and the operation did not; that is still a failure.
    const client = clientDouble(async () => ({
      success: false,
      error: 'Method searchSnapshots not supported in standalone mode',
    }));

    const results = await batchExecute([{ method: 'searchSnapshots' }], client);

    expect(results[0].success).toBe(false);
    expect(results[0].error).toMatch(/not supported/);
  });

  it('records no error for a successful payload', async () => {
    const client = clientDouble(async () => ({ success: true, value: 1 }));
    const results = await batchExecute([{ method: 'getStatus' }], client);

    expect(results[0].error).toBeUndefined();
    expect(results[0].result).toEqual({ success: true, value: 1 });
  });

  it('defaults missing data to an empty object', async () => {
    const seen: unknown[] = [];
    const client = clientDouble(async (_method, data) => {
      seen.push(data);
      return { success: true };
    });

    await batchExecute([{ method: 'getStatus' }], client);

    expect(seen).toEqual([{}]);
  });

  it('returns an empty result list for an empty batch', async () => {
    const client = clientDouble(async () => ({ success: true }));
    await expect(batchExecute([], client)).resolves.toEqual([]);
  });

  // BUG-8: the documented `{ "commands": [...] }` file shape was rejected with
  // "Batch file must contain an array of command objects", so only the bare
  // array form ever worked.
  it('accepts the documented { commands: [...] } wrapper', async () => {
    const calls: string[] = [];
    const client = clientDouble(async (method) => {
      calls.push(method);
      return { success: true };
    });

    const results = await batchExecute(
      {
        commands: [
          { method: 'takeSnapshot', data: { description: 'a' } },
          { method: 'getSnapshots' },
        ],
      },
      client,
    );

    expect(calls).toEqual(['takeSnapshot', 'getSnapshots']);
    expect(results).toHaveLength(2);
  });

  it('accepts an empty { commands: [] } wrapper', async () => {
    const client = clientDouble(async () => ({ success: true }));
    await expect(batchExecute({ commands: [] }, client)).resolves.toEqual([]);
  });

  it('still rejects a shape that is neither an array nor a commands wrapper', async () => {
    const client = clientDouble(async () => ({ success: true }));
    await expect(batchExecute({ nope: 1 }, client)).rejects.toThrow(
      /top-level array|commands/i,
    );
  });
});
