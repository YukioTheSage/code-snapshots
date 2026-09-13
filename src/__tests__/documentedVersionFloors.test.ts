import * as fs from 'fs';
import * as path from 'path';

/**
 * The version floors live in `engines` and are restated in prose, and nothing
 * compared the two: a README claimed VS Code 1.60.0 while `engines.vscode`
 * said ^1.85.0 until a documentation pass noticed. Each check below pins the
 * sentence its document uses today, so changing a floor fails here instead of
 * shipping a document that lies.
 */
const repoRoot = path.join(__dirname, '..', '..');

interface Manifest {
  engines?: Record<string, string>;
}

function readJson(relativePath: string): Manifest {
  return JSON.parse(
    fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'),
  ) as Manifest;
}

function readDocument(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function engineRange(manifestPath: string, engine: string): string {
  const range = readJson(manifestPath).engines?.[engine];
  if (!range) {
    throw new Error(`${manifestPath} declares no engines.${engine}`);
  }
  return range;
}

/** The numeric floor inside a range such as `^1.85.0` or `>=18.15.0`. */
function floorOf(range: string): string {
  const floor = /(\d+\.\d+\.\d+)/.exec(range)?.[1];
  if (!floor) {
    throw new Error(`the engines range "${range}" has no x.y.z floor`);
  }
  return floor;
}

/** Fails with the sentence to paste, not a truncated document diff. */
function expectStated(
  documentPath: string,
  document: string,
  sentence: string,
): void {
  if (!document.includes(sentence)) {
    throw new Error(
      `${documentPath} does not state its version floor. Update its ` +
        `requirements text to contain this exact sentence:\n  ${sentence}`,
    );
  }
}

describe('documented version floors', () => {
  it('states the VS Code floor from package.json in README.md', () => {
    const range = engineRange('package.json', 'vscode');
    const sentence =
      `- **VS Code**: version ${floorOf(range)} or higher ` +
      `(declared as \`engines.vscode: ${range}\`)`;

    expectStated('README.md', readDocument('README.md'), sentence);
  });

  it('states the Node floor from cli/package.json in cli/README.md', () => {
    const range = engineRange('cli/package.json', 'node');
    const sentence = `- **Node.js**: Version ${floorOf(range)} or higher`;

    expectStated('cli/README.md', readDocument('cli/README.md'), sentence);
  });

  it('states the same Node floor in the root README', () => {
    const range = engineRange('cli/package.json', 'node');
    const sentence = `- **CLI only**: Node.js ${floorOf(range)} or higher`;

    expectStated('README.md', readDocument('README.md'), sentence);
  });
});
