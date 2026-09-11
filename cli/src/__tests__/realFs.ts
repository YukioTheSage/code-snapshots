/**
 * Real-filesystem escape hatch for the shared jest setup.
 *
 * `setup.ts` replaces `fs` with a module whose `existsSync`, `writeFileSync`,
 * `mkdirSync` and `unlinkSync` are bare `jest.fn()` no-ops, which is fine for
 * suites that mock their collaborators but silently breaks any suite that
 * creates real fixtures: the writes do nothing and `existsSync` returns
 * `undefined`, so code under test can never see the fixture.
 *
 * Suites that genuinely need disk call `useRealFileSystem()` in a
 * `beforeEach`. Only the stubbed functions are rebound; everything else on the
 * mocked module already delegates to the real implementation.
 */

import * as fs from 'fs';

const actualFs = jest.requireActual<typeof import('fs')>('fs');

const DELEGATED = [
  'existsSync',
  'writeFileSync',
  'mkdirSync',
  'unlinkSync',
] as const;

export function useRealFileSystem(): void {
  for (const name of DELEGATED) {
    const stub = (fs as unknown as Record<string, unknown>)[name];
    const implementation = (
      actualFs as unknown as Record<string, (...args: unknown[]) => unknown>
    )[name];

    if (
      stub &&
      typeof (stub as { mockImplementation?: unknown }).mockImplementation ===
        'function'
    ) {
      (stub as jest.Mock).mockImplementation(implementation);
    }
  }
}
