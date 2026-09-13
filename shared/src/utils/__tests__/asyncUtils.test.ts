import { runWithConcurrencyLimit } from '../asyncUtils';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('runWithConcurrencyLimit', () => {
  it('returns results positionally even when a later task finishes first', async () => {
    const items = [0, 1, 2, 3, 4, 5];

    const results = await runWithConcurrencyLimit(items, 3, async (item) => {
      // The first task is the slowest, so an implementation that pushed each
      // result as it arrived would return 1,2,3,4,5,0 here.
      await sleep(item === 0 ? 40 : 0);
      return `result-${item}`;
    });

    expect(results).toEqual(items.map((item) => `result-${item}`));
  });

  it('never runs more than the limit at once', async () => {
    const items = Array.from({ length: 9 }, (_, index) => index);
    let inFlight = 0;
    let maxInFlight = 0;

    await runWithConcurrencyLimit(items, 3, async (item) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await sleep(5);
      inFlight--;
      return item;
    });

    // Greater than one proves the tasks really overlap; the ceiling is the
    // property under test.
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it('propagates a rejection instead of returning a partial array', async () => {
    const items = [0, 1, 2, 3];

    const run = runWithConcurrencyLimit(items, 2, async (item) => {
      if (item === 0) {
        throw new Error('first read failed');
      }
      await sleep(10);
      return item;
    });

    await expect(run).rejects.toThrow('first read failed');
  });
});
