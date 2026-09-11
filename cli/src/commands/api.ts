/**
 * Direct API invocation (`codelapse api <method> [-d json]`).
 *
 * Extracted from the Commander action so the behaviour is reachable from a
 * test: driving the real program would trip the post-action hook, which closes
 * the client and schedules `process.exit`.
 */

import { setFailure } from '../exitState';
import type { UnifiedClient } from '../unifiedClient';

/**
 * Call one allowlisted API method and print the JSON envelope.
 *
 * Failures are recorded through `exitState` so the CLI exits 1: printing
 * `{"success":false}` while exiting 0 made the documented contract ("exit code
 * is 0 when the payload's success is true and 1 when it is false") false for
 * this command alone.
 */
export async function runApiCall(
  method: string,
  rawData: string | undefined,
  client: Pick<UnifiedClient, 'callApi'>,
  log: (line: string) => void = console.log,
): Promise<void> {
  try {
    const data = rawData ? JSON.parse(rawData) : {};
    const result = await client.callApi(method, data);
    log(JSON.stringify({ success: true, result }));
  } catch (error) {
    log(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    setFailure();
  }
}
