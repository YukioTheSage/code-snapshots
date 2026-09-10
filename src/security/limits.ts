import * as path from 'path';
import { promises as fsPromises } from 'fs';

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
  while (true) {
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

export async function assertSufficientDiskSpace(
  targetPath: string,
  minFreeBytes: number = MIN_FREE_DISK_BYTES,
): Promise<void> {
  const checkPath = await findExistingAncestor(path.dirname(targetPath));

  const statfsFn = (
    fsPromises as unknown as {
      statfs?: (
        path: string,
      ) => Promise<{ bavail: number | bigint; bsize: number | bigint }>;
    }
  ).statfs;
  if (!statfsFn) {
    throw new Error('Disk space check requires Node.js 18+ runtime support');
  }

  const stats = await statfsFn(checkPath);

  if (
    (typeof stats.bavail !== 'number' && typeof stats.bavail !== 'bigint') ||
    (typeof stats.bsize !== 'number' && typeof stats.bsize !== 'bigint')
  ) {
    throw new Error('Disk space check is unavailable on this runtime');
  }

  const freeBytes = Number(stats.bavail) * Number(stats.bsize);
  if (freeBytes < minFreeBytes) {
    throw new Error(
      `Insufficient free disk space at ${checkPath}: ${freeBytes} bytes available, ${minFreeBytes} bytes required`,
    );
  }
}
