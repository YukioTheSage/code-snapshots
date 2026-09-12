import { MAX_JSON_PAYLOAD_BYTES } from 'codelapse-core';
import { CliConnectorService } from '../cliConnectorService';
import * as vscode from 'vscode';

jest.mock('vscode');
jest.mock('../terminalApiService');

describe('server message buffer limit', () => {
  it('destroys a peer that never sends a newline', () => {
    (vscode.workspace as any).workspaceFolders = [];
    const service = new CliConnectorService(
      {} as never,
      {
        extension: { packageJSON: { version: '0.9.5' } },
        subscriptions: [],
      } as never,
      undefined,
      null,
    );
    const destroy = jest.fn();
    const socket = { destroy } as never;
    (service as any).socketBuffers = new Map();

    (service as any).handleSocketData(
      socket,
      Buffer.from('x'.repeat(MAX_JSON_PAYLOAD_BYTES + 1)),
    );

    expect(destroy).toHaveBeenCalled();
    service.dispose();
  });
});