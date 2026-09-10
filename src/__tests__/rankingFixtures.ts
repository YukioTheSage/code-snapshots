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
export function makeResult(
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

export const processedQuery = {
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
export const options = {
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

/**
 * Ranks a single result and returns its composite score.
 *
 * The ranked result is deliberately low-similarity, and the `0.2` is load
 * bearing. `makeResult('src/a.ts', 0.9)` composites to 0.815, and
 * `applyBoostAndPenaltyFactors` clamps to `[0, 1]`, so from that base any
 * factor above 1 saturates the clamp -- `0.815 * 1.24` is 1.0106, which is
 * reported as 1 -- and the factor itself stops being observable. At 0.2 the
 * composite is 0.395: above the 0.1 floor, and low enough that the
 * multipliers under test (up to 2) stay inside the clamp. Do not raise it
 * back to 0.9 without moving the assertions that measure the factor.
 */
export async function rankOne(
  manager: ResultManager,
  searchStrategy: { boostFactors: unknown[]; penaltyFactors: unknown[] },
): Promise<number> {
  const query = {
    ...processedQuery,
    searchStrategy,
  } as unknown as ProcessedQuery;
  const ranked = await manager.rankResults(
    [makeResult('src/a.ts', 0.2)],
    query,
    options,
  );
  return ranked[0].rankingScore ?? 0;
}
