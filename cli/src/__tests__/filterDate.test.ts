/**
 * Regression guard for `filter date` input handling (BUG-4).
 *
 * `parseDate` fell through to `new Date(input).toISOString()` for anything it
 * did not recognize. `toISOString()` throws `RangeError: Invalid time value`
 * on an Invalid Date, and the call sat outside `byDate`'s try/catch, so
 * `codelapse filter date today` died with a bare "Fatal error: Invalid time
 * value" instead of a usable message and exit 1.
 */

import { FilterCommands } from '../commands/filter';
import { getFailure, resetFailure } from '../exitState';
import type { UnifiedClient } from '../unifiedClient';

function commandsWith(client: Partial<UnifiedClient>): FilterCommands {
  return new FilterCommands(client as UnifiedClient);
}

/** Reach the private parser under test. */
function parse(commands: FilterCommands, input: string): string {
  return (commands as unknown as { parseDate: (s: string) => string }).parseDate(
    input,
  );
}

describe('filter date parseDate (BUG-4)', () => {
  const commands = commandsWith({});

  it('parses relative ranges', () => {
    for (const input of ['1h', '2d', '1w', '3m', '1y']) {
      expect(Number.isNaN(new Date(parse(commands, input)).getTime())).toBe(
        false,
      );
    }
  });

  it('parses the "today" keyword instead of crashing', () => {
    const parsed = new Date(parse(commands, 'today')).getTime();
    expect(Number.isNaN(parsed)).toBe(false);
    expect(Math.abs(Date.now() - parsed)).toBeLessThan(60_000);
  });

  it('parses ISO dates', () => {
    expect(parse(commands, '2024-01-01')).toContain('2024-01-01');
  });

  it('rejects unknown words with a helpful message, never a RangeError', () => {
    for (const input of ['week', 'neverland', 'sometime']) {
      expect(() => parse(commands, input)).toThrow(/use a relative range/);
      expect(() => parse(commands, input)).not.toThrow(RangeError);
    }
  });
});

describe('filter date byDate (BUG-4)', () => {
  beforeEach(() => resetFailure());

  it('reports a failure payload and sets the failure flag for a bad range', async () => {
    const calls: unknown[] = [];
    const commands = commandsWith({
      callApi: (async (method: string, data: unknown) => {
        calls.push({ method, data });
        return { snapshots: [] };
      }) as unknown as UnifiedClient['callApi'],
    });

    await commands.byDate('neverland', { json: true } as never);

    expect(getFailure()).toBe(true);
    // The invalid input must not reach the API.
    expect(calls).toEqual([]);
  });

  it('parses a from..to range and forwards it to the API', async () => {
    const calls: { method: string; data: unknown }[] = [];
    const commands = commandsWith({
      callApi: (async (method: string, data: unknown) => {
        calls.push({ method, data });
        return { snapshots: [] };
      }) as unknown as UnifiedClient['callApi'],
    });

    await commands.byDate('2024-01-01..2024-02-01', { json: true } as never);

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('filterSnapshots');
  });
});
