import * as path from 'path';
import { promises as fsPromises } from 'fs';
import { log, logVerbose } from '../logger';

const MB = 1024 * 1024;

export const MAX_JSON_PAYLOAD_BYTES = 10 * MB;
export const MAX_FILE_SIZE_BYTES = 10 * MB;
export const MIN_FREE_DISK_BYTES = 250 * MB;
export const MAX_SNAPSHOT_RESOLUTION_DEPTH = 64;

export async function assertFileSizeWithinLimit(
  filePath: string,
  maxBytes: number = MAX_FILE_SIZE_BYTES,
): Promise<void> {
  const stats = await fsPromises.lstat(filePath);
  if (stats.isSymbolicLink()) {
    throw new Error(`Refusing symlink access: ${filePath}`);
  }
  if (stats.size > maxBytes) {
    throw new Error(
      `File is too large: ${filePath} (${stats.size} bytes > ${maxBytes} bytes)`,
    );
  }
}

export function assertBufferSizeWithinLimit(
  payload: string | Buffer,
  context: string,
  maxBytes: number = MAX_JSON_PAYLOAD_BYTES,
): void {
  const size = Buffer.byteLength(payload);
  if (size > maxBytes) {
    throw new Error(
      `${context} exceeds size limit (${size} bytes > ${maxBytes} bytes)`,
    );
  }
}

async function findExistingAncestor(startPath: string): Promise<string> {
  let current = path.resolve(startPath);
  // `for (;;)` rather than `while (true)`: identical semantics, but it does not
  // trip `no-constant-condition`, which is an error in this project's config.
  for (;;) {
    try {
      const stats = await fsPromises.lstat(current);
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
 * Returns the number of free bytes at the nearest existing ancestor of
 * `dirPath`, or null when the runtime cannot report it.
 *
 * Node exposes `fsPromises.statfs` from 18.15, and VS Code only ships that Node
 * from 1.85. Every caller reaches this through an `unknown` cast because
 * `@types/node` here predates `statfs`, so the runtime check below is the only
 * thing standing between an older host and a `TypeError`.
 */
export async function getFreeDiskBytes(
  dirPath: string,
): Promise<number | null> {
  const statfsFn = (
    fsPromises as unknown as {
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

/**
 * A missing free-space figure is worth saying once, not once per write. Every
 * write path calls the guard, so an unguarded log would flood the output
 * channel on exactly the hosts where the guard cannot run.
 */
let warnedDiskSpaceUnavailable = false;

function warnDiskSpaceUnavailable(): void {
  if (warnedDiskSpaceUnavailable) {
    logVerbose(
      'Free disk space is still unavailable on this runtime; disk-space pre-checks remain skipped.',
    );
    return;
  }
  warnedDiskSpaceUnavailable = true;
  log(
    'Free disk space cannot be read on this runtime (fs.statfs requires Node 18.15, i.e. VS Code 1.85+), so disk-space pre-checks are skipped. Writes will still fail normally if the disk is full.',
  );
}

/** Test seam: lets the one-time warning be re-armed between cases. */
export function resetDiskSpaceWarningForTesting(): void {
  warnedDiskSpaceUnavailable = false;
}

export async function assertSufficientDiskSpace(
  targetPath: string,
  minFreeBytes: number = MIN_FREE_DISK_BYTES,
): Promise<void> {
  const freeBytes = await getFreeDiskBytes(path.dirname(targetPath));

  if (freeBytes === null) {
    // Best effort. An unknown figure is not evidence of a full disk, and
    // throwing here would break every write on a host that simply cannot
    // report free space -- which is the bug this replaced.
    warnDiskSpaceUnavailable();
    return;
  }

  if (freeBytes < minFreeBytes) {
    throw new Error(
      `Insufficient free disk space at ${path.dirname(
        targetPath,
      )}: ${freeBytes} bytes available, ${minFreeBytes} bytes required`,
    );
  }
}
