import { CodeChunker } from '../codeChunker';

/**
 * `--!>` is a legal HTML comment terminator, and the only one some documents
 * use. The pattern recognised `-->` alone, so a comment closed with `--!>` was
 * never closed: the scanner stayed in the comment and counted every following
 * line as a comment line, driving the ratio to 1.
 */
describe('CodeChunker HTML comment terminator', () => {
  let chunker: CodeChunker;

  beforeEach(() => {
    chunker = new CodeChunker();
  });

  /** `calculateCommentRatio` is private; the ratio is its only observable. */
  const ratioOf = (content: string): number =>
    (
      chunker as unknown as {
        calculateCommentRatio(content: string, language: string): number;
      }
    ).calculateCommentRatio(content, 'html');

  it('treats --!> as the end of an HTML comment', () => {
    // Line 1 opens the comment, line 2 closes it, line 3 is ordinary markup:
    // two of the three lines are comment lines.
    expect(ratioOf('<!-- comment\n--!>\n<p>hello</p>')).toBeCloseTo(2 / 3, 5);
  });

  it('still treats --> as the end of an HTML comment', () => {
    expect(ratioOf('<!-- comment\n-->\n<p>hello</p>')).toBeCloseTo(2 / 3, 5);
  });
});
