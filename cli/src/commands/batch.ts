import { UnifiedClient } from '../unifiedClient';
import {
  parseAndValidateBatchCommands,
  BatchApiCommand,
} from '../apiAllowlist';

export interface BatchResult {
  command: BatchApiCommand;
  success: boolean;
  result?: unknown;
  error?: string;
}

/**
 * The reason a failed batch entry failed.
 *
 * A payload with success: false does not always carry a message: the batch
 * handlers in the extension report an all-failed run through their counts, and
 * the paths that do report an error put an OBJECT there. String(result.error)
 * rendered the second as "[object Object]" and the first as "command failed",
 * so a batch entry that failed told the user nothing about why.
 */
function describeFailure(result: unknown): string {
  if (typeof result !== 'object' || result === null) {
    return 'command failed';
  }

  const payload = result as Record<string, unknown>;
  const error = payload.error;

  if (typeof error === 'string' && error.length > 0) {
    return error;
  }
  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) {
      return message;
    }
  }

  // batchAnalyze and batchSearch name their counts differently; accept either.
  const failedCount = payload.failedOperations ?? payload.failedQueries;
  const totalCount = payload.totalOperations ?? payload.totalQueries;
  if (typeof failedCount === 'number' && typeof totalCount === 'number') {
    return failedCount + ' of ' + totalCount + ' item(s) failed';
  }

  return 'command failed';
}

/**
 * Executes each batch command through the normal API path.
 *
 * The previous implementation called `CodeLapseClient.executeCommand`, which
 * returned a hardcoded `{ result: 'success' }` without sending anything -- so
 * `codelapse batch` reported success for commands it never ran. It also never
 * invoked `parseAndValidateBatchCommands`, the validator written for exactly
 * this purpose, which is what keeps an arbitrary method name from reaching the
 * client.
 *
 * A payload whose own `success` is `false` counts as a failed entry even though
 * the call resolved: the transport worked, the operation did not.
 */
export async function batchExecute(
  rawCommands: unknown,
  client: UnifiedClient,
): Promise<BatchResult[]> {
  const commands = parseAndValidateBatchCommands(rawCommands);
  const results: BatchResult[] = [];

  for (const command of commands) {
    try {
      const result = await client.callApi(command.method, command.data ?? {});
      const failed =
        typeof result === 'object' &&
        result !== null &&
        (result as { success?: unknown }).success === false;
      results.push({
        command,
        success: !failed,
        result,
        error: failed ? describeFailure(result) : undefined,
      });
    } catch (error) {
      results.push({
        command,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}
