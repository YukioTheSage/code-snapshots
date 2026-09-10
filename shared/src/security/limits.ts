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

export async function assertSufficientDiskSpace(
  targetPath: string,
  minFreeBytes: number = MIN_FREE_DISK_BYTES,
): Promise<void> {
  const directory = path.dirname(targetPath);
  const stats = await fs.statfs(directory);
  const freeBytes = Number(stats.bavail) * Number(stats.bsize);
  if (freeBytes < minFreeBytes) {
    throw new Error(
      `Insufficient disk space for ${targetPath}: ${freeBytes} bytes available, requires at least ${minFreeBytes} bytes`,
    );
  }
}
