import { ResultManager } from '../services/resultManager';
import { makeResult, options, processedQuery } from './rankingFixtures';

describe('rankResults minimum score threshold', () => {
  it('keeps every result that is above the floor, including the lowest', async () => {
    const manager = new ResultManager();
    // Three distinct files so nothing is dropped for being in the same file,
    // and three distinct similarities so the ordering is unambiguous.
    const results = [
      makeResult('src/a.ts', 0.9),
      makeResult('src/b.ts', 0.7),
      makeResult('src/c.ts', 0.5),
    ];

    const ranked = await manager.rankResults(results, processedQuery, options);

    // Today this is 2: normalization maps src/c.ts to exactly 0 and the floor
    // then discards it, even though its raw composite is well above 0.1.
    expect(ranked).toHaveLength(3);
    expect(ranked.map((r) => r.filePath)).toContain('src/c.ts');
  });

  it('drops a result whose composite score is genuinely below the floor', async () => {
    const manager = new ResultManager();
    const hopeless = makeResult('src/bad.ts', 0);
    hopeless.timestamp = Date.now() - 400 * 24 * 60 * 60 * 1000; // recency 0.1
    hopeless.qualityMetrics.readabilityScore = 0;
    hopeless.qualityMetrics.documentationRatio = 0;
    // The maximum in the same scale as the rest of the fixture, so the quality
    // term is exactly 0 and the floor drops this on the arithmetic rather than
    // on the [0, 1] clamp in applyBoostAndPenaltyFactors. Risk fields are 0-100
    // in the contract, so the maximum is 100.
    hopeless.qualityMetrics.duplicationRisk = 100;
    hopeless.qualityMetrics.performanceRisk = 100;
    hopeless.enhancedMetadata!.usageFrequency = 0;
    hopeless.enhancedMetadata!.complexityMetrics!.cyclomaticComplexity = 50;

    const ranked = await manager.rankResults(
      [makeResult('src/a.ts', 0.9), hopeless],
      processedQuery,
      options,
    );

    expect(ranked.map((r) => r.filePath)).toEqual(['src/a.ts']);
  });

  it('still normalizes the survivors, so rankingScore orders them', async () => {
    const manager = new ResultManager();
    const ranked = await manager.rankResults(
      [makeResult('src/a.ts', 0.9), makeResult('src/b.ts', 0.5)],
      processedQuery,
      options,
    );

    expect(ranked[0].filePath).toBe('src/a.ts');
    expect(ranked[0].rankingScore).toBe(1);
    expect(ranked[1].rankingScore).toBe(0);
    // `score` is a similarity and is never rewritten by normalization.
    expect(ranked[0].score).toBe(0.9);
  });

  it('produces the composite the 0-1 arithmetic produced (Task 2 equality proof)', async () => {
    const manager = new ResultManager();
    // One result: normalization is skipped, so rankingScore is the raw composite.
    // 0.9*0.6 + 0.675*0.2 + 1.0*0.05 + 0.5*0.1 + 1.0*0.03 + 0.5*0.02 = 0.815,
    // where 0.675 = (toRatio(70) + 0.5 + (1 - toRatio(30)) + (1 - toRatio(20))) / 4.
    const ranked = await manager.rankResults(
      [makeResult('src/a.ts', 0.9)],
      processedQuery,
      options,
    );

    expect(ranked[0].rankingScore).toBeCloseTo(0.815, 6);
  });
});
