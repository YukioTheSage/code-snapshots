import { ResultManager } from '../resultManager';
import { QueryProcessor } from '../queryProcessor';
import {
  EnhancedSemanticSearchOptions,
  EnhancedSemanticSearchResult,
  ProcessedQuery,
} from '../../types/enhancedSearch';
import {
  makeResult,
  options,
  processedQuery,
} from '../../__tests__/rankingFixtures';

async function filterWith(
  results: EnhancedSemanticSearchResult[],
  filters: ProcessedQuery['filters'],
): Promise<string[]> {
  const manager = new ResultManager();
  const { results: filtered } = await manager.processResults(
    results,
    { ...processedQuery, filters } as ProcessedQuery,
    { ...options, limit: 10 } as EnhancedSemanticSearchOptions,
  );
  return filtered.map((result) => result.filePath);
}

describe('search result file patterns', () => {
  it('excludes test files for an implementation search', async () => {
    const results = [
      makeResult('src/services/userService.ts', 0.9),
      makeResult('src/services/userService.test.ts', 0.85),
      makeResult('src/services/__tests__/userService.spec.ts', 0.8),
    ];

    const kept = await filterWith(results, {
      excludeFilePatterns: ['*test*', '*spec*', '*.test.*', '*.spec.*'],
    });

    // Before the fix both writers of this field were ignored, so the
    // "exclude test files for implementation searches" rule was dead
    // configuration that read as a working rule.
    expect(kept).toEqual(['src/services/userService.ts']);
  });

  it('includes only the requested extension', async () => {
    const results = [
      makeResult('src/services/userService.ts', 0.9),
      makeResult('src/services/user_service.py', 0.85),
    ];

    const kept = await filterWith(results, { includeFilePatterns: ['*.ts'] });

    // "*.ts" has to match a nested path: it is what determineFilters builds
    // from the language context, and a bare minimatch of a path that contains
    // "/" does not match it.
    expect(kept).toEqual(['src/services/userService.ts']);
  });

  it('matches a Windows path the same way', async () => {
    const results = [
      makeResult('src\\services\\userService.ts', 0.9),
      makeResult('src\\services\\userService.test.ts', 0.85),
    ];

    const kept = await filterWith(results, {
      includeFilePatterns: ['*.ts'],
      excludeFilePatterns: ['*test*'],
    });

    expect(kept).toEqual(['src\\services\\userService.ts']);
  });

  it('keeps the producer and the consumer on the same contract', async () => {
    const processed = await new QueryProcessor().processQuery(
      'find authentication code',
      { language: 'typescript' },
    );

    expect(processed.filters.includeFilePatterns).toEqual(['*.ts']);
  });
});
