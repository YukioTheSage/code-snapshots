/**
 * Process-wide failure flag.
 *
 * Command handlers set it instead of calling `process.exit`, so cleanup (socket
 * close, stdio flush) still runs; the CLI reads it in its post-action hook to
 * choose the exit code.
 *
 * This exists because every handler already printed `{"success": false}` and
 * returned, and `cli.ts` then forced `process.exit(0)` -- so a failure was
 * visible in the output but invisible to any shell wrapper, and every documented
 * CI and agent recipe that branched on exit status succeeded unconditionally.
 */
let failed = false;

export function setFailure(): void {
  failed = true;
}

export function getFailure(): boolean {
  return failed;
}

export function resetFailure(): void {
  failed = false;
}
