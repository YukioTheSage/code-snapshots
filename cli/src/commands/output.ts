import { setFailure } from '../exitState';

/**
 * Prints a command result and records failure when the payload says so.
 *
 * Every handler that reports a result envelope must route it through here: a
 * handler that printed `{success: false}` directly and returned left the process
 * exit code at 0, so a shell wrapper could not tell success from failure.
 *
 * Output is deliberately *unchanged* from the `console.log(JSON.stringify(...))`
 * calls this replaces -- same channel, same compact formatting. Writing to
 * `process.stdout` directly or pretty-printing would have silently reformatted
 * every command's machine-readable output, which this fix has no reason to do.
 */
export function printResult(
  payload: unknown,
  options: { json?: boolean; silent?: boolean },
): void {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'success' in payload &&
    (payload as { success?: unknown }).success === false
  ) {
    setFailure();
  }

  if (options?.silent) {
    return;
  }

  if (options?.json) {
    console.log(JSON.stringify(payload));
    return;
  }

  console.log(formatHuman(payload));
}

function formatHuman(payload: unknown): string {
  if (typeof payload === 'string') {
    return payload;
  }
  return JSON.stringify(payload);
}
