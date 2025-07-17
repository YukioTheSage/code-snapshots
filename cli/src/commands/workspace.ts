import { CodeLapseClient } from '../client';

export class WorkspaceCommands {
  constructor(private client: CodeLapseClient) {}

  async info(options: any): Promise<void> {
    try {
      const info = await this.client.callApi('getWorkspaceInfo', {});
      console.log(JSON.stringify({
        success: true,
        workspace: info
      }));
    } catch (error) {
      console.log(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  }

  async state(options: any): Promise<void> {
    try {
      const state = await this.client.callApi('getCurrentState', {});
      console.log(JSON.stringify({
        success: true,
        state
      }));
    } catch (error) {
      console.log(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  }

  async files(options: any): Promise<void> {
    try {
      const state = await this.client.callApi('getCurrentState', {});
      const result = {
        openFiles: state.openFiles || [],
        changedFiles: state.changedFiles || [],
        activeFile: state.activeFile
      };

      if (options.changed) {
        result.openFiles = result.changedFiles;
      }

      console.log(JSON.stringify({
        success: true,
        files: result
      }));
    } catch (error) {
      console.log(JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  }
} 