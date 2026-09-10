/* eslint-disable @typescript-eslint/no-explicit-any */
import { UnifiedClient } from '../unifiedClient';
import { printResult } from './output';

export class UtilityCommands {
  constructor(private client: UnifiedClient) {}

  async validate(id: string, options: any): Promise<void> {
    try {
      const result = await this.client.callApi('validateSnapshot', { id });
      printResult(
        {
          success: true,
          validation: result,
          message: result.isValid ? 'Snapshot is valid' : 'Snapshot has issues',
        },
        options,
      );
    } catch (error) {
      printResult(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        options,
      );
    }
  }

  async export(id: string, options: any): Promise<void> {
    const exportOpts = {
      format: options.format || 'json',
      outputPath: options.output,
    };

    try {
      const result = await this.client.callApi('exportSnapshot', {
        id,
        ...exportOpts,
      });
      printResult(
        {
          success: true,
          export: result,
          message: `Snapshot exported to ${result.exportPath}`,
        },
        options,
      );
    } catch (error) {
      printResult(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        options,
      );
    }
  }
}
