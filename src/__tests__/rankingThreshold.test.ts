import { ResultManager } from '../services/resultManager';
import {
  EnhancedSemanticSearchResult,
  EnhancedSemanticSearchOptions,
  ProcessedQuery,
} from '../types/enhancedSearch';

/**
 * The content deliberately contains `test`, `try`, `catch` and `error` so the
 * `hasTests` and `hasErrorHandling` conditions can both fire -- Task 3 depends
 * on that.
 *
 * The metric values are the documented 0-100 contract values. They were
 * written here as 0-1 (0.7 / 0.3 / 0.2) while `calculateQualityScore` read
 * them as ratios; Task 2 converted that reader to `toRatio` and moved this
 * fixture to 70 / 30 / 20, which is the same quality term as before, so the
 * composite arithmetic below is unchanged.
 */
function makeResult(
  filePath: string,
  score: number,
  content = 'function testIt() { try { return 1; } catch (error) { return 0; } }',
): EnhancedSemanticSearchResult {
  return {
    snapshotId: 'snap1',
    filePath,
    startLine: 1,
    endLine: 10,
    score,
    content,
    timestamp: Date.now(),
    rankingScore: undefined,
    qualityMetrics: {
      overallScore: 70,
      readabilityScore: 70,
      testCoverage: undefined,
      documentationRatio: 0.5,
      duplicationRisk: 30,
      performanceRisk: 20,
      securityRisk: 15,
      maintainabilityScore: 75,
      technicalDebt: {
        estimatedFixTime: 2,
        severity: 'low',
        categories: [],
        issues: [],
      },
      styleComplianceScore: 80,
    },
    contextInfo: {
      surroundingContext: '',
      architecturalLayer: 'unknown',
      frameworkContext: [],
      businessContext: undefined,
      fileContext: {
        totalLines: 1,
        fileSize: 28,
        lastModified: new Date(),
        encoding: 'utf-8',
        siblingChunks: [],
      },
    },
    enhancedMetadata: {
      semanticType: 'function',
      designPatterns: [],
      architecturalLayer: 'unknown',
      frameworkContext: [],
      dependencies: [],
      usageFrequency: 0.5,
      lastModified: Date.now(),
      complexityMetrics: {
        cyclomaticComplexity: 5,
        cognitiveComplexity: 1,
        linesOfCode: 1,
        nestingDepth: 1,
        maintainabilityIndex: 80,
      },
      securityConsiderations: [],
    },
    relationships: [],
    alternatives: [],
    explanation: undefined,
  } as unknown as EnhancedSemanticSearchResult;
}

const processedQuery = {
  originalQuery: 'x',
  enhancedQuery: 'x',
  intent: {
    primary: 'find_implementation',
    secondary: [],
    confidence: 0.9,
    context: [],
  },
  searchStrategy: { boostFactors: [], penaltyFactors: [] },
  filters: {},
} as unknown as ProcessedQuery;

/**
 * `rankResults` reads only `searchMode`, `rankingStrategy` and `limit` from
 * this; `processResults` (Task 3) needs the fuller shape, so the fixture is
 * the realistic one rather than a minimal cast.
 */
const options = {
  query: 'x',
  searchMode: 'semantic',
  includeExplanations: true,
  includeRelationships: false,
  includeQualityMetrics: true,
  contextRadius: 5,
  rankingStrategy: 'relevance',
  filterCriteria: {},
  limit: 10,
  enableDiversification: true,
  maxResultsPerFile: 2,
} as unknown as EnhancedSemanticSearchOptions;

/** Ranks a single result and returns its composite score. */
async function rankOne(
  manager: ResultManager,
  searchStrategy: { boostFactors: unknown[]; penaltyFactors: unknown[] },
): Promise<number> {
  const query = {
    ...processedQuery,
    searchStrategy,
  } as unknown as ProcessedQuery;
  const ranked = await manager.rankResults(
    [makeResult('src/a.ts', 0.9)],
    query,
    options,
  );
  return ranked[0].rankingScore ?? 0;
}

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
