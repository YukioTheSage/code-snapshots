/* eslint-disable @typescript-eslint/no-explicit-any */
import { UnifiedClient } from '../unifiedClient';
import { printResult } from './output';

export class WorkspaceCommands {
  constructor(private client: UnifiedClient) {}

  async info(options: any): Promise<void> {
    try {
      const info = await this.client.callApi('getWorkspaceInfo', {});
      printResult(
        {
          success: true,
          workspace: info,
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

  async state(options: any): Promise<void> {
    try {
      const state = await this.client.callApi('getCurrentState', {});
      printResult(
        {
          success: true,
          state,
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

  async files(options: any): Promise<void> {
    try {
      const state = await this.client.callApi('getCurrentState', {});
      const result = {
        openFiles: state.openFiles || [],
        changedFiles: state.changedFiles || [],
        activeFile: state.activeFile,
      };

      if (options.changed) {
        result.openFiles = result.changedFiles;
      }

      printResult(
        {
          success: true,
          files: result,
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
