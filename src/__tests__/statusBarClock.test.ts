import * as vscode from 'vscode';
import { StatusBarController } from '../statusBarController';

// The status bar's "time ago" text is a function of the wall clock, so it has
// to refresh even when no snapshot event ever fires. These tests run on a
// frozen fake clock and a manager stub whose event emitter never fires, so any
// text change can only have come from the clock.

const CLOCK_POLL_INTERVAL_MS = 60_000;

describe('StatusBarController clock', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // The shared vscode mock returns a fresh status-bar stub from
  // createStatusBarItem; reach it through jest's recorded call results rather
  // than editing the mock that every other unit suite imports
  // (src/__tests__/__mocks__/vscode.ts:209).
  function buildController() {
    const manager = {
      getSnapshots: jest
        .fn()
        .mockReturnValue([{ id: 's1', timestamp: 0, description: 'first' }]),
      getActiveSnapshot: jest.fn().mockReturnValue(null),
      onDidChangeSnapshots: jest.fn().mockReturnValue({ dispose: jest.fn() }),
    };
    const controller = new StatusBarController(manager as any);
    const item = (vscode.window.createStatusBarItem as jest.Mock).mock
      .results[0].value;
    return { manager, controller, item };
  }

  it('refreshes the time-ago text on the clock with no snapshot event', () => {
    const { controller, item } = buildController();

    // Non-vacuity: the stub already drives real, rendered text at t=0. If the
    // controller rendered nothing, the assertions below would pass on ''.
    expect(item.text).toContain('now');
    expect(item.text).not.toContain('30m');

    // Only the wall clock moves; onDidChangeSnapshots is never fired.
    jest.advanceTimersByTime(30 * 60 * 1000);
    expect(item.text).toContain('30m');

    // And it keeps ticking: a one-shot refresh would leave this at '30m'.
    jest.advanceTimersByTime(CLOCK_POLL_INTERVAL_MS);
    expect(item.text).toContain('31m');

    controller.dispose();
  });

  it('polls once a minute instead of the removed 5s cadence', () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    const { controller } = buildController();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).toHaveBeenCalledWith(
      expect.any(Function),
      CLOCK_POLL_INTERVAL_MS,
    );

    setIntervalSpy.mockRestore();
    controller.dispose();
  });

  it('stops the clock on dispose', () => {
    const { manager, controller } = buildController();

    // Exactly one pending timer: the clock. No other timer is registered.
    expect(jest.getTimerCount()).toBe(1);

    controller.dispose();
    expect(jest.getTimerCount()).toBe(0);

    // Five more poll windows elapse and nothing touches the manager again.
    const callsAfterDispose = manager.getSnapshots.mock.calls.length;
    jest.advanceTimersByTime(CLOCK_POLL_INTERVAL_MS * 5);
    expect(manager.getSnapshots.mock.calls.length).toBe(callsAfterDispose);

    expect(() => controller.dispose()).not.toThrow();
  });
});
