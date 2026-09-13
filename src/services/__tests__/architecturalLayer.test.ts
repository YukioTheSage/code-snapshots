/* eslint-disable @typescript-eslint/no-explicit-any */
import { classifyArchitecturalLayer } from '../architecturalLayer';
import { ResultManager } from '../resultManager';
import { SemanticSearchService } from '../semanticSearchService';
import { EnhancedSemanticSearchOptions } from '../../types/enhancedSearch';
import {
  makeResult,
  options,
  processedQuery,
} from '../../__tests__/rankingFixtures';

describe('classifyArchitecturalLayer', () => {
  it.each([
    ['src/ui/controllers/userController.ts', 'presentation'],
    ['src/routes/userRoutes.ts', 'presentation'],
    ['src/services/userService.ts', 'business'],
    ['src/repositories/userRepository.ts', 'data'],
    ['src/models/user.ts', 'domain'],
    ['src/entities/order.ts', 'domain'],
    ['src/utils/format.ts', 'utility'],
    ['src/services/__tests__/userService.test.ts', 'test'],
    ['src/services/__tests__/helpers.ts', 'test'],
    ['src/config/settings.ts', 'configuration'],
    // Segment aware, not substring aware: "apiary" is not an "api".
    ['src/apiary/hive.ts', 'unknown'],
    ['README', 'unknown'],
    // The tokenizer splits on `_`, so `__mocks__` arrives as the token
    // `mocks`; without that token a mock directory was not a test directory.
    ['src/__mocks__/api.ts', 'test'],
    ['src/services/__mocks__/api.ts', 'test'],
    // The segment-aware set's `/domain/` -> "business" mapping: the token wins
    // over the layer the word names.
    ['src/domain/order.ts', 'business'],
    // The tokenizer splits on `-`, so a hyphenated `api` is a whole token.
    ['src/api-client.ts', 'presentation'],
  ])('classifies %s as %s', (filePath, expected) => {
    expect(classifyArchitecturalLayer(filePath)).toBe(expected);
  });

  it('treats a backslash path like a forward-slash path', () => {
    expect(classifyArchitecturalLayer('src\\services\\userService.ts')).toBe(
      'business',
    );
  });
});

describe('both call sites now agree', () => {
  it('returns domain for a model path from the result manager', async () => {
    const manager = new ResultManager();

    const { results } = await manager.processResults(
      [makeResult('src/models/user.ts', 0.9)],
      processedQuery,
      { ...options, limit: 10 } as EnhancedSemanticSearchOptions,
    );

    expect(results[0].enhancedMetadata.architecturalLayer).toBe('domain');
  });

  it('returns domain for a model path from the search service', () => {
    const service = new SemanticSearchService(
      { getSnapshots: () => [], onDidChangeSnapshots: jest.fn() } as never,
      {
        hasCredentials: jest.fn().mockResolvedValue(true),
        promptForCredentials: jest.fn(),
      } as never,
      {
        workspaceState: { get: jest.fn(() => []), update: jest.fn() },
      } as never,
    );

    // Before the fix this returned "model" while the result manager returned
    // "domain" for the same path - the disagreement the spec records.
    expect(
      (service as any).detectArchitecturalLayer('src/models/user.ts'),
    ).toBe('domain');
  });
});
