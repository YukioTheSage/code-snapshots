import * as fs from 'fs/promises';
import * as path from 'path';

export const MAX_JSON_PAYLOAD_BYTES = 10 * 1024 * 1024; // 10MB
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
export const MIN_FREE_DISK_BYTES = 250 * 1024 * 1024; // 250MB
export const MAX_SNAPSHOT_RESOLUTION_DEPTH = 64;

export async function assertFileSizeWithinLimit(
  filePath: string,
  maxBytes: number = MAX_FILE_SIZE_BYTES,
): Promise<void> {
  const stats = await fs.stat(filePath);
  if (stats.size > maxBytes) {
    throw new Error(
      `File size limit exceeded for ${filePath}: ${stats.size} bytes > ${maxBytes} bytes`,
    );
  }
}

export function assertBufferSizeWithinLimit(
  content: string,
  context: string,
  maxBytes: number = MAX_JSON_PAYLOAD_BYTES,
): void {
  const size = Buffer.byteLength(content, 'utf8');
  if (size > maxBytes) {
    throw new Error(
      `Payload size limit exceeded for ${context}: ${size} bytes > ${maxBytes} bytes`,
    );
  }
}

/**
 * Walks up from `startPath` to the nearest ancestor that exists, so the probe
 * also works for a directory that has not been created yet.
 */
async function findExistingAncestor(startPath: string): Promise<string> {
  let current = path.resolve(startPath);
  for (;;) {
    try {
      const stats = await fs.lstat(current);
      if (stats.isSymbolicLink()) {
        throw new Error(`Refusing symlink access: ${current}`);
      }
      return current;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'ENOENT') {
        throw error;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        return current;
      }
      current = parent;
    }
  }
}

/**
 * Free bytes at the nearest existing ancestor of `dirPath`, or null when the
 * runtime cannot report it.
 *
 * `fs.statfs` was added in Node **18.15.0**, not 18.0. This module previously
 * called it unguarded, so on Node 18.0-18.14 -- which
 * `engines.node: ">=18.0.0"` advertised as supported -- `statfs` was
 * `undefined` and every index, snapshot and config write failed with
 * `TypeError: fs.statfs is not a function`.
 *
 * A library has no logger, so an unreadable figure is reported by returning
 * null and the caller decides; `assertSufficientDiskSpace` treats it as
 * "unknown", not "full".
 */
export async function getFreeDiskBytes(
  dirPath: string,
): Promise<number | null> {
  const statfsFn = (
    fs as unknown as {
      statfs?: (
        path: string,
      ) => Promise<{ bavail: number | bigint; bsize: number | bigint }>;
    }
  ).statfs;

  if (typeof statfsFn !== 'function') {
    return null;
  }

  const checkPath = await findExistingAncestor(dirPath);
  const stats = await statfsFn(checkPath);

  if (
    (typeof stats.bavail !== 'number' && typeof stats.bavail !== 'bigint') ||
    (typeof stats.bsize !== 'number' && typeof stats.bsize !== 'bigint')
  ) {
    return null;
  }

  return Number(stats.bavail) * Number(stats.bsize);
}

export async function assertSufficientDiskSpace(
  targetPath: string,
  minFreeBytes: number = MIN_FREE_DISK_BYTES,
): Promise<void> {
  const freeBytes = await getFreeDiskBytes(path.dirname(targetPath));

  if (freeBytes === null) {
    // Best effort. An unknown figure is not evidence of a full disk, and
    // throwing here would break every write on a host that merely cannot
    // report free space.
    return;
  }

  if (freeBytes < minFreeBytes) {
    throw new Error(
      `Insufficient disk space for ${targetPath}: ${freeBytes} bytes available, requires at least ${minFreeBytes} bytes`,
    );
  }
}
