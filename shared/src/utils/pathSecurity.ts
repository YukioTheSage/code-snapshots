import * as path from 'path';
import * as fs from 'fs';

/**
 * Validates that a resolved path stays within the expected root directory.
 * Prevents path traversal attacks (e.g., "../../etc/passwd").
 *
 * @param rootDir The trusted root directory (must be absolute)
 * @param untrustedPath The untrusted path to validate (relative to rootDir)
 * @returns The resolved, validated absolute path
 * @throws Error if the path escapes rootDir or is absolute
 */
export function ensureWithinDirectory(rootDir: string, untrustedPath: string): string {
  // Reject absolute paths in untrusted input
  if (path.isAbsolute(untrustedPath)) {
    throw new Error(
      `Path traversal blocked: absolute path not allowed: "${untrustedPath}"`,
    );
  }

  const normalizedRoot = path.normalize(rootDir);
  const resolved = path.normalize(path.resolve(normalizedRoot, untrustedPath));

  // The resolved path must equal rootDir or start with rootDir + separator
  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + path.sep)) {
    throw new Error(
      `Path traversal blocked: "${untrustedPath}" resolves outside root directory`,
    );
  }

  return resolved;
}

/**
 * Rejects symbolic links on any existing segment of a path under the root.
 * This prevents link-based path escaping within otherwise valid paths.
 */
export function assertNoSymlinkPath(rootDir: string, absolutePath: string): void {
  const normalizedRoot = path.resolve(rootDir);
  const normalizedTarget = path.resolve(absolutePath);

  if (
    normalizedTarget !== normalizedRoot &&
    !normalizedTarget.startsWith(normalizedRoot + path.sep)
  ) {
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

    if (!fs.existsSync(current)) {
      break;
    }

    const stats = fs.lstatSync(current);
    if (stats.isSymbolicLink()) {
      throw new Error(`Symlink access blocked: ${current}`);
    }
  }
}

/**
 * Validates that a snapshot ID contains only safe characters.
 * Prevents directory traversal via crafted snapshot IDs.
 *
 * @param snapshotId The snapshot ID to validate
 * @returns The validated snapshot ID (unchanged)
 * @throws Error if the ID contains unsafe characters
 */
export function validateSnapshotId(snapshotId: string): string {
  if (!snapshotId || typeof snapshotId !== 'string') {
    throw new Error('Invalid snapshot ID: must be a non-empty string');
  }

  // Allow alphanumeric, hyphens, underscores, and dots (no path separators)
  if (!/^[a-zA-Z0-9._-]+$/.test(snapshotId)) {
    throw new Error(
      `Invalid snapshot ID: "${snapshotId}" contains disallowed characters. Only [a-zA-Z0-9._-] are permitted.`,
    );
  }

  return snapshotId;
}
