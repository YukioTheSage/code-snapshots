/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * A lint ceiling, not a cleanup target. The task that removed the dead
 * semantic-search surface brought the warning count down; a number that only
 * moves down is a state where a new warning cannot hide.
 *
 * The ESLint JavaScript API is used instead of `execFileSync('npx', ...)`:
 * Node cannot spawn child processes in this workspace, and the API measures the
 * same warnings without a subprocess.
 */
import * as path from 'path';

interface LintResult {
  errorCount: number;
  warningCount: number;
}

interface EslintApi {
  lintFiles(patterns: string[]): Promise<LintResult[]>;
}

const { ESLint } = require('eslint') as {
  ESLint: new (options: { cwd: string }) => EslintApi;
};

const LINT_WARNING_CEILING = 455;
const repoRoot = path.join(__dirname, '..', '..');

describe('lint budget', () => {
  it('does not exceed the recorded warning ceiling', async () => {
    const eslint = new ESLint({ cwd: repoRoot });
    const results = await eslint.lintFiles(['src/**/*.ts']);
    const warnings = results.reduce(
      (total: number, result: LintResult) => total + result.warningCount,
      0,
    );
    const errors = results.reduce(
      (total: number, result: LintResult) => total + result.errorCount,
      0,
    );

    // The ceiling alone is blind to errors: this programme twice saw the budget
    // pass while an error sat in the tree, the last one a prettier violation on
    // new code. An error fails here as well as in the explicit sum and in
    // `format:check`.
    expect(errors).toBe(0);
    expect(warnings).toBeLessThanOrEqual(LINT_WARNING_CEILING);
  }, 120_000);
});
