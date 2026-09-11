/**
 * Regression guard for `files export` output paths (BUG from the review).
 *
 * `exportSnapshotFile` handed the caller's output path straight to core's
 * `ensureWithinDirectory`, which rejects *any* absolute path as a traversal
 * attempt. An absolute destination inside the workspace -- the natural thing
 * to pass from a script that knows its own root -- therefore failed with
 * "Path traversal blocked: absolute path not allowed", while a relative path
 * worked.
 */

import * as path from 'path';
import { toWorkspaceRelativeOutputPath } from '../standaloneHandler';

const ROOT = path.resolve('C:/proj');

describe('toWorkspaceRelativeOutputPath', () => {
  it('leaves relative paths alone', () => {
    expect(toWorkspaceRelativeOutputPath(ROOT, 'out.json')).toBe('out.json');
    // Pass-through means the caller's spelling is preserved; core resolves it
    // against the workspace root and normalises separators itself.
    expect(toWorkspaceRelativeOutputPath(ROOT, 'data/out.json')).toBe(
      'data/out.json',
    );
  });

  it('accepts an absolute path inside the workspace root', () => {
    const target = path.join(ROOT, 'data', 'out.json');
    expect(toWorkspaceRelativeOutputPath(ROOT, target)).toBe(
      path.join('data', 'out.json'),
    );
  });

  it('accepts the workspace root itself (relative result is empty)', () => {
    expect(toWorkspaceRelativeOutputPath(ROOT, ROOT)).toBe('');
  });

  it('rejects an absolute path outside the workspace root', () => {
    expect(() =>
      toWorkspaceRelativeOutputPath(ROOT, path.resolve('C:/elsewhere/out.json')),
    ).toThrow(/outside the workspace root/i);
  });

  it('rejects a sibling directory whose name shares the root prefix', () => {
    expect(() =>
      toWorkspaceRelativeOutputPath(ROOT, path.resolve('C:/projAgain/out.json')),
    ).toThrow(/outside the workspace root/i);
  });

  it('leaves traversal sequences for the core guard to reject', () => {
    // Relative input is validated by ensureWithinDirectory, which is where the
    // ../.. rejection lives; this helper must not turn it into an absolute
    // path that would then be refused for the wrong reason.
    expect(toWorkspaceRelativeOutputPath(ROOT, '../escape.json')).toBe(
      '../escape.json',
    );
  });
});
