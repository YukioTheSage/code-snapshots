import { ResultManager } from '../services/resultManager';
import { QueryProcessor } from '../services/queryProcessor';
import { ProcessedQuery } from '../types/enhancedSearch';
import {
  makeResult,
  options,
  processedQuery,
  rankOne,
} from './rankingFixtures';

describe('boost and penalty arithmetic', () => {
  it('applies a weighted share of a boost, not the multiplier times the weight', async () => {
    // multiplier 1.3 with weight 0.8 means "80% of a 1.3x boost", which is
    // 1 + 0.3 * 0.8 = 1.24 -- not 1.3 * 0.8 = 1.04.
    const manager = new ResultManager();
    const boosted = await rankOne(manager, {
      boostFactors: [
        {
          condition: 'hasTests',
          multiplier: 1.3,
          weight: 0.8,
          description: '',
        },
      ],
      penaltyFactors: [],
    });
    const unboosted = await rankOne(manager, {
      boostFactors: [],
      penaltyFactors: [],
    });

    expect(boosted / unboosted).toBeCloseTo(1.24, 5);
  });

  it('applies a weighted share of a penalty', async () => {
    // multiplier 0.7 with weight 0.6 means "60% of a 0.7x penalty" =
    // 1 - 0.3 * 0.6 = 0.82.
    const manager = new ResultManager();
    const penalized = await rankOne(manager, {
      boostFactors: [],
      penaltyFactors: [
        {
          condition: 'hasErrorHandling',
          multiplier: 0.7,
          weight: 0.6,
          description: '',
        },
      ],
    });
    const plain = await rankOne(manager, {
      boostFactors: [],
      penaltyFactors: [],
    });

    expect(penalized / plain).toBeCloseTo(0.82, 5);
  });

  it('treats weight 0 as no effect and weight 1 as the full multiplier', async () => {
    const manager = new ResultManager();
    const plain = await rankOne(manager, {
      boostFactors: [],
      penaltyFactors: [],
    });
    const zero = await rankOne(manager, {
      boostFactors: [
        { condition: 'hasTests', multiplier: 3, weight: 0, description: '' },
      ],
      penaltyFactors: [],
    });
    const full = await rankOne(manager, {
      boostFactors: [
        { condition: 'hasTests', multiplier: 2, weight: 1, description: '' },
      ],
      penaltyFactors: [],
    });

    expect(zero / plain).toBeCloseTo(1, 5);
    expect(full / plain).toBeCloseTo(2, 5);
  });
});

describe('the [0, 1] clamp', () => {
  /**
   * The two factors the registered intents actually apply, with the weight each
   * `QueryProcessor.getBoostFactors` pairs them with. `rankOne` deliberately
   * ranks a 0.395-composite result so the interpolation stays measurable below
   * the clamp; these are the values that measure the clamp itself.
   */
  const SATURATING_FACTORS = [
    {
      // find_examples: 1 + 0.3 * 0.8 = 1.24
      factor: {
        condition: 'hasTests',
        multiplier: 1.3,
        weight: 0.8,
        description: '',
      },
      multiplier: 1.24,
    },
    {
      // debug_issue: 1 + 0.4 * 0.9 = 1.36
      factor: {
        condition: 'hasErrorHandling',
        multiplier: 1.4,
        weight: 0.9,
        description: '',
      },
      multiplier: 1.36,
    },
  ];

  it('ties two saturated results at 1 and leaves them in input order', async () => {
    // The composite is 0.6 * similarity + 0.275 with this fixture (relevance
    // weights, DEFAULT_QUALITY_METRICS, a fresh timestamp, usageFrequency 0.5
    // and cyclomaticComplexity 5 at the intent's ideal), so both results below
    // composite above 0.806 -- `find_examples`' saturation threshold -- and
    // above 0.735, `debug_issue`'s. A lone result skips normalization (the
    // range is 0), which is what makes its raw composite observable.
    const manager = new ResultManager();
    const plain = await manager.rankResults(
      [makeResult('src/lower.ts', 0.94)],
      processedQuery,
      options,
    );
    expect(plain[0].rankingScore).toBeCloseTo(0.6 * 0.94 + 0.275, 5);

    for (const { factor, multiplier } of SATURATING_FACTORS) {
      // Both composites exceed 1 / multiplier, so both are clamped to exactly
      // 1: the tie is what the clamp produces, and the stable sort keeps the
      // input order -- lower-scoring result first -- rather than relevance
      // order. This is asserted rather than left emergent, so a change to the
      // clamp or to the factor arithmetic has to face it.
      const query = {
        ...processedQuery,
        searchStrategy: { boostFactors: [factor], penaltyFactors: [] },
      } as unknown as ProcessedQuery;

      const ranked = await manager.rankResults(
        [makeResult('src/lower.ts', 0.94), makeResult('src/higher.ts', 0.95)],
        query,
        options,
      );

      expect(plain[0].rankingScore).toBeGreaterThanOrEqual(1 / multiplier);
      expect(ranked.map((r) => r.rankingScore)).toEqual([1, 1]);
      expect(ranked.map((r) => r.filePath)).toEqual([
        'src/lower.ts',
        'src/higher.ts',
      ]);
    }
  });
});

describe('alternative results', () => {
  it('reports an alternative for two similar chunks in the same directory', async () => {
    // calculateSimilarity caps at 0.2667, so a 0.6 threshold made this list
    // permanently empty while the API still advertised `alternatives`. Two
    // functions in one directory with similar scores reach 0.2.
    const manager = new ResultManager();
    const { results } = await manager.processResults(
      [makeResult('src/a.ts', 0.9), makeResult('src/b.ts', 0.88)],
      processedQuery,
      options,
    );

    expect(results[0].alternatives.length).toBeGreaterThan(0);
  });

  it('does not offer a chunk in the same file as an alternative to itself', async () => {
    // The top of the band excludes these on purpose: two functions in one file
    // at nearly equal scores reach the function's ceiling, and offering one as
    // an "alternative implementation" of the other is noise.
    const manager = new ResultManager();
    const { results } = await manager.processResults(
      [makeResult('src/a.ts', 0.9), makeResult('src/a.ts', 0.88)],
      processedQuery,
      options,
    );

    expect(results[0].alternatives).toHaveLength(0);
  });
});

describe('penalty conditions', () => {
  it('does not register a penalty that can never be evaluated', async () => {
    // `hasCodeSmells` was pushed for every intent while `evaluateCondition`
    // returned a literal false for it, so no query could ever apply it.
    const processed = await new QueryProcessor().processQuery(
      'find examples of error handling',
    );

    expect(
      processed.searchStrategy.penaltyFactors.map((f) => f.condition),
    ).not.toContain('hasCodeSmells');
  });

  it('records why noDocumentation cannot fire yet', async () => {
    // documentationRatio is hardcoded to 0.5 in DEFAULT_QUALITY_METRICS because
    // the search path produces no metrics (SemanticSearchResult has no
    // qualityMetrics field). The condition is correct code waiting for real
    // input, not dead code -- so it stays, and this test fails if the default
    // moves below 0.2 without the search path being wired up.
    const { DEFAULT_QUALITY_METRICS } = await import(
      '../services/qualityScale'
    );
    expect(DEFAULT_QUALITY_METRICS.documentationRatio).toBeGreaterThanOrEqual(
      0.2,
    );
  });
});
