/**
 * Guards for the CI workflow itself.
 *
 * Every defect this class of test exists to prevent was found in this repository:
 * CI ran `format -- --check` (which REWRITES files and exits 0, so the gate could
 * never fail), it ran no Jest step at all, and the CLI's test files were
 * type-checked by nothing. A workflow is a document like any other, and nothing
 * else in the suite reads it — so deleting a gate, or pointing one at a script
 * that does not exist, would go unnoticed until the failure it was supposed to
 * catch reached a release.
 */

import * as fs from 'fs';
import * as path from 'path';

const repoRoot = path.join(__dirname, '..', '..');
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'ci.yml');

function readWorkflow(): string {
  return fs.readFileSync(workflowPath, 'utf8');
}

/** The `run:` bodies of the workflow, in order. */
function runSteps(workflow: string): string[] {
  return [...workflow.matchAll(/^\s*-?\s*run:\s*(.+)$/gm)].map((m) => m[1]);
}

function scriptsOf(packageJsonPath: string): Record<string, string> {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
    scripts?: Record<string, string>;
  };
  return pkg.scripts ?? {};
}

interface PackageSpec {
  name: string;
  dir: string;
  required: string[];
}

const packages: PackageSpec[] = [
  {
    name: 'extension',
    dir: repoRoot,
    required: [
      'check-types',
      'lint',
      'format:check',
      // The gate that could not fail: `format -- --check` is `prettier --write`
      // plus `--check`, which rewrites and exits 0.
      'compile',
    ],
  },
  {
    name: 'cli',
    dir: path.join(repoRoot, 'cli'),
    required: [
      'check-types',
      'check-types:test',
      'lint',
      'format:check',
      'test:ci',
      'build',
    ],
  },
];

describe('CI workflow gates', () => {
  const workflow = readWorkflow();

  it('runs the gates for both packages', () => {
    for (const spec of packages) {
      const scripts = scriptsOf(path.join(spec.dir, 'package.json'));
      for (const script of spec.required) {
        // A CI step calling a missing script fails at the step, not at review.
        expect(scripts[script]).toBeDefined();
        expect(workflow).toContain(`npm run ${script}`);
      }
    }
  });

  it('runs the test suite', () => {
    // The extension job has no script for it and invokes jest directly.
    expect(workflow).toMatch(/npx jest --runInBand/);
    expect(workflow).toContain('npm run test:ci');
  });

  it('never uses a gate that rewrites the files it is checking', () => {
    const steps = runSteps(workflow);
    const rewritesInPlace = steps.filter(
      (step) => /\bprettier\s+--write\b/.test(step) || /--write\b/.test(step),
    );
    expect(rewritesInPlace).toEqual([]);
    // `npm run format -- --check` expands to `prettier --write … --check`.
    expect(workflow).not.toMatch(/npm run format\s+--\s+--check/);
  });

  it('runs jest in band, which the forked pool cannot do in a sandbox', () => {
    for (const step of runSteps(workflow)) {
      if (/\bjest\b/.test(step)) {
        expect(step).toContain('--runInBand');
      }
    }
  });

  it('type-checks the CLI test files the build config excludes', () => {
    const cliTsconfig = fs.readFileSync(
      path.join(repoRoot, 'cli', 'tsconfig.json'),
      'utf8',
    );
    const testTsconfig = JSON.parse(
      fs
        .readFileSync(path.join(repoRoot, 'cli', 'tsconfig.test.json'), 'utf8')
        .replace(/^\s*\/\/.*$/gm, ''),
    ) as { include?: string[]; exclude?: string[] };

    // The exclusion is deliberate: tests must not be emitted to dist/. That is
    // exactly why they need their own config and their own CI step.
    expect(cliTsconfig).toContain('**/*.test.ts');
    expect(workflow).toContain('npm run check-types:test');
    expect(testTsconfig.exclude ?? []).not.toContain('**/*.test.ts');
  });
});
