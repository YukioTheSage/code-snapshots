/**
 * Regression guard for the `api` command's exit status (BUG-5).
 *
 * Every other command group marks a failure through `exitState`, which the
 * post-action hook turns into exit code 1. The `api` action printed
 * `{"success":false,...}` and returned, so a rejected method, a malformed
 * `-d` payload and a missing snapshot all exited 0 -- breaking the contract
 * documented in HELP.md that exit status mirrors the payload's `success`.
 */

import { runApiCall } from '../commands/api';
import { getFailure, resetFailure } from '../exitState';
import type { UnifiedClient } from '../unifiedClient';

function fakeClient(
  behaviour: (method: string, data: unknown) => Promise<unknown>,
): UnifiedClient {
  return { callApi: behaviour } as unknown as UnifiedClient;
}

/** Collect what the command would print instead of writing to the console. */
function collector(): { lines: string[]; log: (line: string) => void } {
  const lines: string[] = [];
  return { lines, log: (line: string) => lines.push(line) };
}

describe('api command exit state (BUG-5)', () => {
  beforeEach(() => resetFailure());

  it('prints the result and stays successful for a served method', async () => {
    const { lines, log } = collector();
    const client = fakeClient(async () => ({ connected: true }));

    await runApiCall('getStatus', undefined, client, log);

    expect(JSON.parse(lines[0])).toEqual({
      success: true,
      result: { connected: true },
    });
    expect(getFailure()).toBe(false);
  });

  it('marks failure when the api method is rejected', async () => {
    const { lines, log } = collector();
    const client = fakeClient(async (method) => {
      throw new Error(`API method "${method}" is not allowed`);
    });

    await runApiCall('makeCoffee', undefined, client, log);

    expect(JSON.parse(lines[0]).success).toBe(false);
    expect(getFailure()).toBe(true);
  });

  it('marks failure when -d is not valid JSON', async () => {
    const { lines, log } = collector();
    const client = fakeClient(async () => ({ never: 'called' }));

    await runApiCall('getSnapshots', '{bad', client, log);

    expect(JSON.parse(lines[0]).success).toBe(false);
    expect(getFailure()).toBe(true);
  });

  it('passes parsed JSON data through to the client', async () => {
    const { log } = collector();
    const seen: unknown[] = [];
    const client = fakeClient(async (_method, data) => {
      seen.push(data);
      return 'ok';
    });

    await runApiCall('getSnapshot', '{"id":"snapshot-1"}', client, log);

    expect(seen).toEqual([{ id: 'snapshot-1' }]);
  });
});
