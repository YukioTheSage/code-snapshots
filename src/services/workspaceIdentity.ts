import * as crypto from 'crypto';

/**
 * One workspace identity for both the IPC pipe name and the vector store.
 *
 * 128 bits, not the first 32: the pipe name is the only thing keeping two
 * workspaces' servers apart, and a 32-bit id collides around 2^16 paths. The
 * vector scope must be derived the same way so the two features agree about
 * what "the workspace" means.
 */
export function getWorkspaceId(
  workspaceRoot: string | null | undefined,
): string {
  if (workspaceRoot) {
    return crypto
      .createHash('sha256')
      .update(workspaceRoot)
      .digest('hex')
      .substring(0, 32);
  }

  return Math.random().toString(36).substring(2, 10);
}
