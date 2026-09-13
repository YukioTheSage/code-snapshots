import { withTimeout } from '../cliConnectorService';

jest.mock('vscode');

/**
 * The callers validate their timeout before racing, but the value that reaches
 * `setTimeout` is the argument of this function -- and `setTimeout` clamps a
 * delay above 2147483647ms, or a NaN, to 1ms. A caller that skipped its own
 * check would therefore get an immediate, fabricated timeout. CodeQL cannot
 * follow the callers' validation across the function boundary
 * (js/resource-exhaustion), so the guard belongs here.
 */
describe('withTimeout delay ceiling', () => {
  it('refuses a delay above the timer ceiling at the sink, not only at the call sites', async () => {
    // `work` is already resolved, so an unguarded sink resolves this call and
    // never reports the invalid delay.
    await expect(
      withTimeout(Promise.resolve('done'), 5_000_000_000_000, 'unused'),
    ).rejects.toThrow(/Invalid timeout/);
  });

  it('refuses a NaN delay, which setTimeout would treat as 1ms', async () => {
    await expect(
      withTimeout(Promise.resolve('done'), Number.NaN, 'unused'),
    ).rejects.toThrow(/Invalid timeout/);
  });

  it('arms the timer with the delay it was given for a valid timeout', async () => {
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

    try {
      await expect(
        withTimeout(Promise.resolve('ok'), 250, 'unused'),
      ).resolves.toBe('ok');

      expect(setTimeoutSpy.mock.calls.map((call) => call[1])).toContain(250);
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });
});
