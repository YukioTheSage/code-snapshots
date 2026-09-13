import { ResultManager } from '../resultManager';
import { EnhancedSemanticSearchOptions } from '../../types/enhancedSearch';
import {
  makeResult,
  options,
  processedQuery,
} from '../../__tests__/rankingFixtures';

/** Unix ms for the middle of a calendar quarter. */
function timestampIn(year: number, quarter: number): number {
  return new Date(year, quarter * 3, 15).getTime();
}

/**
 * Seven results from one quarter and one from an earlier one: the uneven time
 * groups are what makes temporal diversification lossy. `maxPerGroup` is
 * `max(1, floor(8 / 2)) = 4`, so the recent group is truncated from seven to
 * four and five results come back instead of eight. Every result is in its own
 * file and its own function, so the file and function limits never bite.
 */
function eightResultsAcrossTwoQuarters() {
  const recent = Array.from({ length: 7 }, (_, index) =>
    makeResult(
      `src/recent/file${index}.ts`,
      0.9 - index * 0.01,
      `export const recent${index} = ${index};`,
    ),
  );
  const older = makeResult('src/older/file.ts', 0.5, 'export const older = 1;');
  recent.forEach((result) => {
    result.timestamp = timestampIn(2025, 3);
  });
  older.timestamp = timestampIn(2025, 0);
  return [...recent, older];
}

describe('ResultManager diversification flag', () => {
  it('keeps every admitted result when diversification is disabled', async () => {
    const manager = new ResultManager();
    const disabled = {
      ...options,
      enableDiversification: false,
      limit: 20,
    } as EnhancedSemanticSearchOptions;

    const diversified = await manager.diversifyResults(
      eightResultsAcrossTwoQuarters(),
      processedQuery,
      disabled,
    );

    // Before the fix the flag flipped only the three `preferDifferent*`
    // options; the quarterly re-rank still ran and returned 5 of the 8.
    expect(diversified).toHaveLength(8);
  });

  it('still applies the temporal re-rank by default', async () => {
    const manager = new ResultManager();
    const defaults = { ...options, limit: 20 } as EnhancedSemanticSearchOptions;

    const diversified = await manager.diversifyResults(
      eightResultsAcrossTwoQuarters(),
      processedQuery,
      defaults,
    );

    expect(diversified).toHaveLength(5);
  });
});
