import * as path from 'path';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';

/**
 * The root as a prefix that `resolved` can be compared against.
 *
 * `path.normalize` preserves a trailing separator, so appending `path.sep` to a
 * root that already ends in one produced a doubled separator and rejected every
 * path under it; a drive root (`C:\`) did the same. Removing the trailing
 * separator first is what makes the check about containment rather than about
 * how the caller happened to spell the root.
 */
function containmentPrefix(normalizedRoot: string): string {
  const withoutTrailingSeparator =
    normalizedRoot.endsWith(path.sep) && normalizedRoot !== path.sep
      ? normalizedRoot.slice(0, -path.sep.length)
      : normalizedRoot;
  return withoutTrailingSeparator.endsWith(path.sep)
    ? withoutTrailingSeparator
    : withoutTrailingSeparator + path.sep;
}

function isWithin(normalizedRoot: string, resolved: string): boolean {
  const prefix = containmentPrefix(normalizedRoot);
  // The root itself, or the root's own prefix when it is a drive/filesystem
  // root (`C:\` already ends in a separator).
  return (
    resolved === normalizedRoot ||
    resolved === prefix ||
    resolved.startsWith(prefix)
  );
}

/**
 * Validates that a resolved path stays within the expected root directory.
 * Prevents path traversal attacks (e.g., "../../etc/passwd").
 */
export function ensureWithinDirectory(
  rootDir: string,
  untrustedPath: string,
): string {
  if (path.isAbsolute(untrustedPath)) {
    throw new Error(
      `Path traversal blocked: absolute path not allowed: "${untrustedPath}"`,
    );
  }

  const normalizedRoot = path.normalize(rootDir);
  const resolved = path.normalize(path.resolve(normalizedRoot, untrustedPath));

  if (!isWithin(normalizedRoot, resolved)) {
    throw new Error(
      `Path traversal blocked: "${untrustedPath}" resolves outside root directory`,
    );
  }

  return resolved;
}

/**
 * Asserts that no existing segment between root and target is a symlink.
 */
export async function assertNoSymlinkPath(
  rootDir: string,
  absolutePath: string,
): Promise<void> {
  const normalizedRoot = path.resolve(rootDir);
  const normalizedTarget = path.resolve(absolutePath);

  if (!isWithin(normalizedRoot, normalizedTarget)) {
    throw new Error(
      `Path safety check failed: "${absolutePath}" is outside root directory`,
    );
  }

  const relative = path.relative(normalizedRoot, normalizedTarget);
  if (!relative) {
    return;
  }

  const segments = relative.split(path.sep).filter(Boolean);
  let current = normalizedRoot;

  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      const stats = await fsPromises.lstat(current);
      if (stats.isSymbolicLink()) {
        throw new Error(`Symlink access blocked: ${current}`);
      }
    } catch (error) {
      const errno = error as NodeJS.ErrnoException;
      if (errno.code === 'ENOENT') {
        break;
      }
      throw error;
    }
  }
}

export function assertNoSymlinkPathSync(
  rootDir: string,
  absolutePath: string,
): void {
  const normalizedRoot = path.resolve(rootDir);
  const normalizedTarget = path.resolve(absolutePath);

  if (!isWithin(normalizedRoot, normalizedTarget)) {
    throw new Error(
      `Path safety check failed: "${absolutePath}" is outside root directory`,
    );
  }

  const relative = path.relative(normalizedRoot, normalizedTarget);
  if (!relative) {
    return;
  }

  const segments = relative.split(path.sep).filter(Boolean);
  let current = normalizedRoot;

  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      const stats = fs.lstatSync(current);
      if (stats.isSymbolicLink()) {
        throw new Error(`Symlink access blocked: ${current}`);
      }
    } catch (error) {
      const errno = error as NodeJS.ErrnoException;
      if (errno.code === 'ENOENT') {
        break;
      }
      throw error;
    }
  }
}

/**
 * Validates that a snapshot ID contains only safe characters.
 */
export function validateSnapshotId(snapshotId: string): string {
  if (!snapshotId || typeof snapshotId !== 'string') {
    throw new Error('Invalid snapshot ID: must be a non-empty string');
  }

  if (!/^[a-zA-Z0-9._-]+$/.test(snapshotId)) {
    throw new Error(
      `Invalid snapshot ID: "${snapshotId}" contains disallowed characters. Only [a-zA-Z0-9._-] are permitted.`,
    );
  }

  return snapshotId;
}
