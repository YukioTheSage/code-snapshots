/* eslint-disable @typescript-eslint/no-explicit-any */
import { CodeChunker } from '../codeChunker';

/**
 * A file with a whitespace-only gap longer than `chunkOverlap`.
 *
 * Breakpoints are seeded at line 0 and at the line count, added at every line
 * matching a language pattern (for a `.txt` file: `#` or `//` at the start) and
 * added after every pair of consecutive empty lines. That yields three
 * non-empty chunks -- lines 0-9, the pattern line 10 (extended to line 12 by the
 * overlap branch) and lines 71-100 -- with 58 lines of whitespace between the
 * second and the third. 58 >= `chunkOverlap` (50) is what selects
 * `applyChunkOverlapping`'s large-gap branch, the one that embeds the previous
 * chunk's tail.
 */
function buildFixture(): string[] {
  const lines: string[] = [];
  lines.push('// section one'); // 0
  for (let index = 1; index <= 9; index++) {
    lines.push(`const a${index} = ${index};`); // 1-9
  }
  lines.push('// section two'); // 10
  for (let index = 0; index < 60; index++) {
    lines.push(''); // 11-70, skipped as empty chunks
  }
  lines.push('const b1 = 1;'); // 71
  for (let index = 2; index <= 30; index++) {
    lines.push(`const b${index} = ${index};`); // 72-100
  }
  return lines;
}

describe('CodeChunker context chunks', () => {
  it('reports the range of the text it embedded', async () => {
    const chunker = new CodeChunker();

    // The branch this test reaches needs a positive overlap and a quarter-chunk
    // context window. If the host settings change these, the fixture stops
    // producing a context chunk and this test says so instead of passing
    // vacuously.
    expect((chunker as any).chunkOverlap).toBe(50);
    expect((chunker as any).chunkSize).toBe(200);

    const lines = buildFixture();
    const chunks = await chunker.chunkFile(
      'src/example.txt',
      lines.join('\n'),
      'snap-1',
    );

    const contextChunk = chunks.find((chunk) =>
      chunk.content.includes('// ...'),
    );
    expect(contextChunk).toBeDefined();

    // Before the fix this chunk reported 71..100 while its content began at
    // line 0: the previous chunk's tail, the separator, then the current chunk.
    expect(contextChunk?.startLine).toBe(0);
    expect(contextChunk?.endLine).toBe(100);

    // The durable contract, checked for every chunk: the reported range starts
    // at the content's first line and ends at its last.
    for (const chunk of chunks) {
      const contentLines = chunk.content.split('\n');
      expect(contentLines[0]).toBe(lines[chunk.startLine]);
      expect(contentLines[contentLines.length - 1]).toBe(lines[chunk.endLine]);
    }
  });
});
