import { CodeLapseClient } from '../client';

export class UtilityCommands {
  constructor(private client: CodeLapseClient) {}

  async validate(id: string, options: any): Promise<void> {
    try {
      const result = await this.client.callApi('validateSnapshot', { id });
      console.log(JSON.stringify({
        success: true,
        validation: result,
        message: result.isValid ? 'Snapshot is valid' : 'Snapshot has issues'
      }));
    } catch (error) {
      console.log(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  }

  async export(id: string, options: any): Promise<void> {
    const exportOpts = {
      format: options.format || 'json',
      outputPath: options.output
    };

    try {
      const result = await this.client.callApi('exportSnapshot', { id, ...exportOpts });
      console.log(JSON.stringify({
        success: true,
        export: result,
        message: `Snapshot exported to ${result.exportPath}`
      }));
    } catch (error) {
      console.log(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  }
} 