/* eslint-disable @typescript-eslint/no-explicit-any */
import { CodeLapseClient } from '../client';

/**
 * Every request the client writes arms a `connectionTimeout` timer, and that
 * timer was never cancelled when the request settled.
 *
 * `clearTimeout` existed only in `ensureConnection`; the per-request timer in
 * `callApi` (and the one in `performHandshake`) had no handle kept anywhere, so
 * each successful call left a live 5-second timer behind. A pending timer keeps
 * the Node event loop alive after the work is finished, which is why the CLI's
 * jest run reports "A worker process has failed to exit gracefully and has been
 * force exited" -- and why a real `codelapse` process would sit for up to
 * `connectionTimeout` after its last request before exiting.
 *
 * The same class of bug was fixed in `cliConnectorService.withTimeout`, which
 * clears its timer in a `finally`.
 *
 * `jest.getTimerCount()` is the assertion because it measures the leaked handle
 * itself rather than a proxy for it: with fake timers, an armed-but-unnecessary
 * timeout is exactly one live timer.
 */
describe('CodeLapseClient request timers', () => {
  let client: CodeLapseClient;
  let socket: { write: jest.Mock; destroy: jest.Mock };

  /** Let the async `callApi` reach its `new Promise` executor. */
  async function flushMicrotasks(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
    }
  }

  /** The id the client handed to the request now in flight. */
  function inFlightId(): number {
    return (client as any).requestId;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    client = new CodeLapseClient();
    socket = { write: jest.fn().mockReturnValue(true), destroy: jest.fn() };
    (client as any).socket = socket;
    jest.spyOn(client as any, 'ensureConnection').mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('cancels the request timer when the response arrives', async () => {
    const pending = client.callApi('getStatus', {});
    await flushMicrotasks();

    // In flight: the timeout really is armed, so the assertion below can fail.
    expect(jest.getTimerCount()).toBe(1);

    (client as any).handleMessage({
      id: inFlightId(),
      success: true,
      result: 'ok',
    });

    await expect(pending).resolves.toBe('ok');
    expect(jest.getTimerCount()).toBe(0);
    expect((client as any).pendingRequests.size).toBe(0);
  });

  it('cancels the request timer when the server refuses', async () => {
    const pending = client.callApi('getStatus', {});
    await flushMicrotasks();
    expect(jest.getTimerCount()).toBe(1);

    (client as any).handleMessage({
      id: inFlightId(),
      success: false,
      error: 'nope',
    });

    await expect(pending).rejects.toThrow('nope');
    expect(jest.getTimerCount()).toBe(0);
    expect((client as any).pendingRequests.size).toBe(0);
  });

  it('cancels the request timer when the client disconnects mid-flight', async () => {
    const pending = client.callApi('getStatus', {});
    await flushMicrotasks();
    expect(jest.getTimerCount()).toBe(1);

    await client.disconnect();

    await expect(pending).rejects.toThrow('Connection closed');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('leaves no timer and no pending entry when there is no socket', async () => {
    (client as any).socket = undefined;

    await expect(client.callApi('getStatus', {})).rejects.toThrow(
      'No socket connection',
    );

    expect(jest.getTimerCount()).toBe(0);
    expect((client as any).pendingRequests.size).toBe(0);
  });

  it('cancels the handshake timer once authentication completes', async () => {
    (client as any).connectionInfo = { authToken: 'token' };

    const handshake = (client as any).performHandshake();
    await flushMicrotasks();
    expect(jest.getTimerCount()).toBe(1);

    (client as any).handleMessage({
      id: inFlightId(),
      success: true,
      result: { authenticated: true },
    });

    await expect(handshake).resolves.toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('still times out a request that is never answered', async () => {
    const pending = client.callApi('getStatus', {});
    await flushMicrotasks();

    jest.advanceTimersByTime(5000);

    await expect(pending).rejects.toThrow('Request timeout');
    expect(jest.getTimerCount()).toBe(0);
    expect((client as any).pendingRequests.size).toBe(0);
  });
});
