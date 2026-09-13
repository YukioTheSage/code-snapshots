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
  filterCriteria?: ProcessedQuery['filters'],
): Promise<string[]> {
  const manager = new ResultManager();
  const { results: filtered } = await manager.processResults(
    results,
    { ...processedQuery, filters } as ProcessedQuery,
    {
      ...options,
      limit: 10,
      filterCriteria: filterCriteria ?? {},
    } as EnhancedSemanticSearchOptions,
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

    // Caller-supplied patterns, not the producer's: a pattern list handed to
    // the manager is honoured verbatim, substring globs included.
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

describe('the producer excludes test paths, not substrings', () => {
  const testPatterns = [
    '*.test.*',
    '*.spec.*',
    '{test,tests,__tests__,spec,__spec__}',
  ];

  it('emits test-specific patterns for an implementation search', async () => {
    const processed = await new QueryProcessor().processQuery(
      'find implementation of authentication',
      { language: 'typescript' },
    );

    // A segment rule plus "*test*" excluded src/latest/index.ts and
    // src/contest/entry.ts from implementation searches, so the patterns have
    // to name tests directly. The directory forms stay brace-expanded single
    // segments, which is the shape the segment rule can match.
    expect(processed.filters.excludeFilePatterns).toEqual(testPatterns);
  });

  it('keeps paths whose segments merely contain "test" or "spec"', async () => {
    const results = [
      makeResult('src/latest/index.ts', 0.9),
      makeResult('src/contest/entry.ts', 0.85),
      makeResult('src/inspector/panel.ts', 0.8),
      makeResult('src/perspective/view.ts', 0.75),
    ];

    const processed = await new QueryProcessor().processQuery(
      'find implementation of authentication',
      { language: 'typescript' },
    );

    expect(await filterWith(results, processed.filters)).toEqual([
      'src/latest/index.ts',
      'src/contest/entry.ts',
      'src/inspector/panel.ts',
      'src/perspective/view.ts',
    ]);
  });

  it('excludes real test files and test directories', async () => {
    const results = [
      makeResult('src/services/userService.ts', 0.95),
      makeResult('src/services/userService.test.ts', 0.92),
      makeResult('src/services/userService.spec.ts', 0.88),
      makeResult('src/test/helpers.ts', 0.84),
      makeResult('src/tests/helpers.ts', 0.8),
      makeResult('src/__tests__/helpers.ts', 0.76),
      makeResult('src/spec/helpers.ts', 0.72),
      makeResult('src/__spec__/helpers.ts', 0.68),
    ];

    const processed = await new QueryProcessor().processQuery(
      'find implementation of authentication',
      { language: 'typescript' },
    );

    expect(await filterWith(results, processed.filters)).toEqual([
      'src/services/userService.ts',
    ]);
  });
});

describe('the include filter for a language with no known extension', () => {
  it('is omitted rather than a "*.*" that drops dotless paths', async () => {
    const processed = await new QueryProcessor().processQuery(
      'find authentication code',
      { language: 'vue' },
    );

    // getFileExtensionForLanguage fell back to '*', so the include filter
    // became '*.*': it read as "match everything" while dropping Makefile,
    // Dockerfile and LICENSE, and it only became live when the pattern filter
    // was wired up.
    expect(processed.filters.includeFilePatterns).toBeUndefined();
  });

  it('keeps dotless results for such a language', async () => {
    const results = [
      makeResult('Makefile', 0.9),
      makeResult('Dockerfile', 0.85),
      makeResult('LICENSE', 0.8),
    ];

    const processed = await new QueryProcessor().processQuery(
      'find authentication code',
      { language: 'markdown' },
    );

    expect(await filterWith(results, processed.filters)).toEqual([
      'Makefile',
      'Dockerfile',
      'LICENSE',
    ]);
  });

  it('still filters by extension when the language is known', async () => {
    const processed = await new QueryProcessor().processQuery(
      'find authentication code',
      { language: 'python' },
    );

    expect(processed.filters.includeFilePatterns).toEqual(['*.py']);
  });
});

describe('the second writer of the pattern fields', () => {
  it('applies patterns passed through options.filterCriteria', async () => {
    const results = [
      makeResult('src/services/userService.ts', 0.9),
      makeResult('src/services/userService.test.ts', 0.85),
      makeResult('src/services/user_service.py', 0.8),
    ];

    // The first argument carries no filters at all, so only
    // options.filterCriteria can be responsible for the result set.
    const kept = await filterWith(
      results,
      {},
      {
        includeFilePatterns: ['*.ts'],
        excludeFilePatterns: ['*.test.*'],
      },
    );

    expect(kept).toEqual(['src/services/userService.ts']);
  });
});

describe('absent and empty pattern lists', () => {
  const results = [
    makeResult('src/services/userService.ts', 0.9),
    makeResult('src/latest/index.ts', 0.85),
    makeResult('Makefile', 0.8),
  ];
  const allKept = [
    'src/services/userService.ts',
    'src/latest/index.ts',
    'Makefile',
  ];

  it('keeps every result when both lists are undefined', async () => {
    expect(await filterWith(results, {})).toEqual(allKept);
  });

  it('keeps every result when both lists are empty', async () => {
    expect(
      await filterWith(results, {
        includeFilePatterns: [],
        excludeFilePatterns: [],
      }),
    ).toEqual(allKept);
  });
});
