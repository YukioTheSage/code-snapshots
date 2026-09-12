/* eslint-disable @typescript-eslint/no-explicit-any */
import { CliConnectorService } from '../cliConnectorService';
import * as vscode from 'vscode';

jest.mock('vscode');

describe('workspace id entropy', () => {
  function id(workspacePath: string): string {
    const service = new CliConnectorService(
      {} as never,
      {
        extension: { packageJSON: { version: '0.9.5' } },
        subscriptions: [],
      } as never,
      undefined,
      null,
    );
    (vscode.workspace as any).workspaceFolders = [
      { uri: { fsPath: workspacePath } },
    ];
    const result = (service as any).getWorkspaceId();
    service.dispose();
    return result;
  }

  it('uses 128 bits, not 32', () => {
    expect(id('/tmp/workspace-one')).toHaveLength(32);
  });

  it('is stable for one path and different for another', () => {
    expect(id('/tmp/workspace-one')).toBe(id('/tmp/workspace-one'));
    expect(id('/tmp/workspace-one')).not.toBe(id('/tmp/workspace-two'));
  });
});
