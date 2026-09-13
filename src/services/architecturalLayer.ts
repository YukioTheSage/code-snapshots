import { ArchitecturalLayer } from '../types/enhancedChunking';

/**
 * The one architectural-layer classifier for the search pipeline.
 *
 * `ResultManager.inferArchitecturalLayer` used to match substrings, so
 * `src/apiary/hive.ts` was "presentation" (it contains "api") and
 * `src/models/user.ts` was "domain"; `SemanticSearchService`
 * `detectArchitecturalLayer` matched whole path segments and called the same
 * model path "model", had a "test" layer and no "configuration" layer at all.
 * A path therefore carried two different layers depending on which pipeline
 * looked at it.
 *
 * This module keeps the segment-aware set, because substring matching is what
 * produced the false positives, and uses the merged output vocabulary: the
 * "domain" name the result manager used for model/entity paths, and the "test"
 * and "configuration" layers the search service was missing. The one mapping
 * that does not survive the merge is the segment-aware set's `/domain/` ->
 * "business": a directory literally named "domain" is classified "business",
 * which is what the segment-aware set has always said.
 *
 * Rules, in order:
 *   1. any test token anywhere in the path wins, so `src/services/__tests__/`
 *      and `foo.test.ts` are both "test";
 *   2. otherwise the rightmost token that names a layer wins, so the file name
 *      outranks the directories above it;
 *   3. otherwise "unknown".
 */

/**
 * The split in `tokenize` breaks on `_`, so the brief's `__tests__` and
 * `__mocks__` samples arrive as the tokens `tests` and `mocks`; `mocks` is
 * listed instead of the `__mocks__` literal, which could never fire. The
 * `__tests__` literal is kept because the brief names it and is inert -
 * `tests` already covers every path it would have matched.
 */
const TEST_TOKENS = new Set([
  'test',
  'tests',
  'spec',
  'specs',
  '__tests__',
  'mocks',
  'e2e',
  'fixtures',
]);

/**
 * Layer tokens, checked from the rightmost token leftwards. A token appears in
 * exactly one list.
 */
const LAYER_TOKENS: ReadonlyArray<
  readonly [ArchitecturalLayer, readonly string[]]
> = [
  [
    'presentation',
    [
      'controller',
      'controllers',
      'api',
      'apis',
      'endpoint',
      'endpoints',
      'route',
      'routes',
      'handler',
      'handlers',
      'view',
      'views',
    ],
  ],
  [
    'business',
    [
      'service',
      'services',
      'business',
      'logic',
      'usecase',
      'usecases',
      // The segment-aware set mapped a `domain` directory to "business".
      'domain',
      'domains',
    ],
  ],
  [
    'data',
    [
      'repository',
      'repositories',
      'dao',
      'daos',
      'data',
      'database',
      'databases',
      'persistence',
      'migration',
      'migrations',
    ],
  ],
  ['domain', ['model', 'models', 'entity', 'entities', 'schema', 'schemas']],
  [
    'utility',
    [
      'util',
      'utils',
      'utility',
      'utilities',
      'helper',
      'helpers',
      'common',
      'lib',
    ],
  ],
  [
    'configuration',
    [
      'config',
      'configs',
      'configuration',
      'configurations',
      'setting',
      'settings',
      'options',
      'env',
    ],
  ],
];

function tokenize(filePath: string): string[] {
  return filePath
    .toLowerCase()
    .split(/[\\/._-]+/)
    .filter((token) => token.length > 0);
}

export function classifyArchitecturalLayer(
  filePath: string,
): ArchitecturalLayer {
  const tokens = tokenize(filePath);

  // Rule 1: a test token anywhere wins. `src/services/__tests__/helpers.ts` is
  // a test file in a business directory, and the test reading is the useful one.
  if (tokens.some((token) => TEST_TOKENS.has(token))) {
    return 'test';
  }

  // Rule 2: rightmost first, so a file name outranks its directories.
  for (let index = tokens.length - 1; index >= 0; index--) {
    for (const [layer, layerTokens] of LAYER_TOKENS) {
      if (layerTokens.includes(tokens[index])) {
        return layer;
      }
    }
  }

  return 'unknown';
}
