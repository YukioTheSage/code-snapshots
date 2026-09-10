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
        error: failed
          ? String((result as { error?: unknown }).error ?? 'command failed')
          : undefined,
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
