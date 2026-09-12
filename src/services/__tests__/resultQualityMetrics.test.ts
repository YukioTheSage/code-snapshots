import { ResultManager } from '../resultManager';
import { DEFAULT_QUALITY_METRICS } from '../qualityScale';

describe('per-result quality metrics', () => {
  function baseResult(content: string, qualityMetrics?: unknown) {
    return {
      snapshotId: 'snapshot-1',
      snapshot: { id: 'snapshot-1' },
      filePath: 'src/a.ts',
      startLine: 0,
      endLine: 10,
      score: 0.8,
      content,
      timestamp: 1,
      ...(qualityMetrics ? { qualityMetrics } : {}),
    };
  }

  it('keeps the metrics a result carries instead of overwriting them', async () => {
    const manager = new ResultManager();
    const metrics = {
      ...DEFAULT_QUALITY_METRICS,
      overallScore: 91,
      readabilityScore: 95,
    };

    const [enhanced] = await (manager as any).convertToEnhancedResults(
      [baseResult('const a = 1;', metrics)],
      {},
    );

    expect(enhanced.qualityMetrics.overallScore).toBe(91);
  });

  it('falls back to the defaults for a result with no metrics', async () => {
    const manager = new ResultManager();

    const [enhanced] = await (manager as any).convertToEnhancedResults(
      [baseResult('const a = 1;')],
      {},
    );

    expect(enhanced.qualityMetrics.overallScore).toBe(70);
  });

  it('makes the noDocumentation penalty reachable with real ratios', async () => {
    const manager = new ResultManager();
    const [low] = await (manager as any).convertToEnhancedResults(
      [
        baseResult('const a = 1;', {
          ...DEFAULT_QUALITY_METRICS,
          documentationRatio: 0.1,
        }),
      ],
      {},
    );
    const [high] = await (manager as any).convertToEnhancedResults(
      [
        baseResult('const a = 1;', {
          ...DEFAULT_QUALITY_METRICS,
          documentationRatio: 0.5,
        }),
      ],
      {},
    );

    expect((manager as any).evaluateCondition('noDocumentation', low)).toBe(
      true,
    );
    expect((manager as any).evaluateCondition('noDocumentation', high)).toBe(
      false,
    );
  });
});