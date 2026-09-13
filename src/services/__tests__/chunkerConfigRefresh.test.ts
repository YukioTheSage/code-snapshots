import { CodeChunker } from '../codeChunker';
import * as vscode from 'vscode';

/**
 * Stubs the configuration both read paths can use: the raw scoped read the
 * constructor used to make (`get('chunkSize')`) and the resolver's dotted read
 * (`get('semanticSearch.chunkSize')`, with `inspect()` returning undefined so
 * `resolveSetting` takes its compatibility branch).
 */
function stubConfiguration(values: {
  chunkSize?: number;
  chunkOverlap?: number;
}): void {
  const get = jest.fn((key: string, fallback?: unknown) => {
    const leaf = key.includes('.') ? key.slice(key.lastIndexOf('.') + 1) : key;
    if (leaf === 'chunkSize' && values.chunkSize !== undefined) {
      return values.chunkSize;
    }
    if (leaf === 'chunkOverlap' && values.chunkOverlap !== undefined) {
      return values.chunkOverlap;
    }
    return fallback;
  });
  (
    vscode.workspace as unknown as { getConfiguration: jest.Mock }
  ).getConfiguration = jest.fn(() => ({
    get,
    has: jest.fn(() => false),
    update: jest.fn(),
    inspect: jest.fn(),
  }));
}

// A file whose sections are large enough that the chunk size decides where the
// breakpoints go: `findFileBreakpoints` only inserts intermediate points inside
// a section larger than `chunkSize * 2`, so 100 lines are one chunk at 200 and
// five chunks at 20.
function codeLines(count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `const line${index} = ${index};`,
  );
}

describe('CodeChunker.refreshConfig', () => {
  it('re-reads the chunk size and splits at the new boundary', async () => {
    stubConfiguration({ chunkSize: 200 });
    const chunker = new CodeChunker();
    const lines = codeLines(100);

    const before = await chunker.chunkFile(
      'src/example.txt',
      lines.join('\n'),
      'snap-1',
    );
    expect(before).toHaveLength(1);

    stubConfiguration({ chunkSize: 20 });
    chunker.refreshConfig();

    const after = await chunker.chunkFile(
      'src/example.txt',
      lines.join('\n'),
      'snap-1',
    );

    // The observable boundary, not a private field: five 20-line sections.
    expect(after).toHaveLength(5);
    expect(after[0].endLine).toBe(19);
    expect(after[4].endLine).toBe(99);
  });

  it('re-reads the overlap and applies it to the next run', async () => {
    stubConfiguration({ chunkSize: 200, chunkOverlap: 0 });
    const chunker = new CodeChunker();
    const lines = codeLines(500);

    const before = await chunker.chunkFile(
      'src/example.txt',
      lines.join('\n'),
      'snap-1',
    );
    // No overlap: the chunks are the raw breakpoint sections.
    expect(before.map((chunk) => chunk.startLine)).toEqual([0, 166, 333]);

    stubConfiguration({ chunkSize: 200, chunkOverlap: 50 });
    chunker.refreshConfig();

    const after = await chunker.chunkFile(
      'src/example.txt',
      lines.join('\n'),
      'snap-1',
    );
    // With a 50-line overlap the small-gap branch extends each chunk backwards
    // by half the overlap, so the starts move.
    expect(after.map((chunk) => chunk.startLine)).toEqual([0, 141, 308]);
  });

  it('falls back to the declared default when the stored value is not a number', async () => {
    // `.vscode/codelapse.json` is written by the CLI and can be hand-edited, and
    // `resolveSetting` casts a shared-file value to the caller's type without
    // checking it. Without the guard `Math.max(10, '20')` coerces the string
    // and silently installs a 20-line chunk size instead of the default 200.
    stubConfiguration({ chunkSize: '20' as unknown as number });
    const chunker = new CodeChunker();
    const lines = codeLines(100);

    const chunks = await chunker.chunkFile(
      'src/example.txt',
      lines.join('\n'),
      'snap-1',
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0].endLine).toBe(99);
  });
});
