import { CodeChunker } from '../services/codeChunker';
import * as vscode from 'vscode';

function configureChunker(chunkSize: number, chunkOverlap: number) {
  (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
    get: (key: string, fallback?: unknown) =>
      key === 'chunkSize'
        ? chunkSize
        : key === 'chunkOverlap'
        ? chunkOverlap
        : fallback,
    update: jest.fn(),
  });
}

/** Every line index that no chunk covers. */
function uncoveredLines(
  chunks: Array<{ startLine: number; endLine: number }>,
  totalLines: number,
): number[] {
  const covered = new Set<number>();
  for (const chunk of chunks) {
    for (let i = chunk.startLine; i <= chunk.endLine; i++) {
      covered.add(i);
    }
  }
  return Array.from({ length: totalLines }, (_, i) => i).filter(
    (i) => !covered.has(i),
  );
}

describe('CodeChunker line coverage', () => {
  beforeEach(() => configureChunker(20, 5));

  it('covers the tail of a file that has a section marker', async () => {
    const content = [
      'line 0',
      'line 1',
      'line 2',
      '// SECTION',
      'line 4',
      'line 5',
      'line 6',
      'line 7',
      'line 8',
    ].join('\n');

    const chunker = new CodeChunker();
    const chunks = await chunker.chunkFile('src/sample.txt', content, 'snap1');

    expect(chunks.length).toBeGreaterThan(0);
    expect(uncoveredLines(chunks, 9)).toEqual([]);
  });

  it('produces at least one chunk for a JSON file', async () => {
    const content = JSON.stringify(
      { a: 1, b: 2, c: [1, 2, 3], d: { nested: true }, e: 'text' },
      null,
      2,
    );

    const chunker = new CodeChunker();
    const chunks = await chunker.chunkFile('config.json', content, 'snap1');

    // The bug: this was 0, so no JSON or config file was ever indexed.
    expect(chunks.length).toBeGreaterThan(0);
    const totalLines = content.split('\n').length;
    expect(uncoveredLines(chunks, totalLines)).toEqual([]);
  });

  it('produces at least one chunk for a markdown file', async () => {
    const content = Array.from({ length: 10 }, (_, i) => `para ${i}`).join(
      '\n\n',
    );

    const chunker = new CodeChunker();
    const chunks = await chunker.chunkFile('README.md', content, 'snap1');

    expect(chunks.length).toBeGreaterThan(0);
    expect(uncoveredLines(chunks, content.split('\n').length)).toEqual([]);
  });

  it('returns no chunks for an empty file rather than one empty chunk', async () => {
    const chunker = new CodeChunker();
    const chunks = await chunker.chunkFile('empty.txt', '', 'snap1');
    expect(chunks).toEqual([]);
  });

  it('never emits a chunk that runs past the end of the file', async () => {
    const content = Array.from({ length: 50 }, (_, i) => `line ${i}`).join(
      '\n',
    );
    const chunker = new CodeChunker();
    const chunks = await chunker.chunkFile('long.txt', content, 'snap1');

    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.startLine).toBeGreaterThanOrEqual(0);
      expect(chunk.endLine).toBeLessThan(50);
      expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine);
    }
  });

  it('covers every line of a file larger than one chunk', async () => {
    const content = Array.from({ length: 50 }, (_, i) => `line ${i}`).join(
      '\n',
    );
    const chunker = new CodeChunker();
    const chunks = await chunker.chunkFile('long.txt', content, 'snap1');

    expect(uncoveredLines(chunks, 50)).toEqual([]);
  });

  it('gives each chunk a distinct id', async () => {
    // Two chunks of the same file share a snapshot and path; only the line
    // span and content hash separate them.
    const content = Array.from({ length: 50 }, (_, i) => `line ${i}`).join(
      '\n',
    );
    const chunker = new CodeChunker();
    const chunks = await chunker.chunkFile('long.txt', content, 'snap1');

    const ids = chunks.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
