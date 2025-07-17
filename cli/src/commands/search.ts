import { CodeLapseClient } from '../client';

export class SearchCommands {
  constructor(private client: CodeLapseClient) {}

  async query(query: string, options: any): Promise<void> {
    const searchOpts = {
      query,
      limit: parseInt(options.limit) || 20,
      scoreThreshold: parseFloat(options.threshold) || 0.65,
      snapshotIds: options.snapshots ? options.snapshots.split(',').map((s: string) => s.trim()) : undefined,
      languages: options.languages ? options.languages.split(',').map((l: string) => l.trim()) : undefined,
    };

    try {
      const results = await this.client.callApi('searchSnapshots', searchOpts);
      console.log(JSON.stringify({
        success: true,
        query,
        results,
        total: results.length,
        options: searchOpts
      }));
    } catch (error) {
      console.log(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  }

  async index(options: any): Promise<void> {
    try {
      const result = await this.client.callApi('indexSnapshots', {
        snapshotIds: options.all ? undefined : []
      });
      console.log(JSON.stringify({
        success: true,
        indexing: result,
        message: 'Snapshots indexed successfully'
      }));
    } catch (error) {
      console.log(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  }
} 