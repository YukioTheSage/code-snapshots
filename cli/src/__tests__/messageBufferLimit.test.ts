import { MAX_JSON_PAYLOAD_BYTES } from 'codelapse-core';
import { CodeLapseClient } from '../client';

describe('client message buffer limit', () => {
  it('drops a peer that never sends a newline', () => {
    const client = new CodeLapseClient();
    const destroy = jest.fn();
    const handlers: Record<string, (arg?: unknown) => void> = {};
    (client as any).socket = {
      on: (event: string, handler: (arg?: unknown) => void) => {
        handlers[event] = handler;
      },
      destroy,
    };

    (client as any).readResponseData('x'.repeat(MAX_JSON_PAYLOAD_BYTES + 1));

    expect(destroy).toHaveBeenCalled();
  });

  it('keeps parsing normally below the limit', () => {
    const client = new CodeLapseClient();
    const destroy = jest.fn();
    (client as any).socket = { destroy };

    (client as any).readResponseData('{"id":1,"success":true}\n');

    expect(destroy).not.toHaveBeenCalled();
  });
});
