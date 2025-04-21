import * as diff from 'diff';
import { log } from './logger'; // Import logger for error reporting

/**
 * Creates a diff patch between two content strings.
 * @param oldFileName - The path/name for the old file in the patch header.
 * @param oldContent - The original content.
 * @param newContent - The new content.
 * @returns The diff patch string, or an empty string if contents are identical.
 */
export function createDiff(
  oldFileName: string,
  oldContent: string,
  newContent: string,
): string {
  if (oldContent === newContent) {
    return ''; // No changes
  }
  return diff.createPatch(oldFileName, oldContent, newContent);
}

/**
 * Applies a diff patch to the base content.
 * @param baseContent - The original content to apply the patch to.
 * @param patchStr - The diff patch string.
 * @param relativePath - The file path for logging purposes.
 * @returns The patched content, or null if patching fails or results in deletion.
 */
export function applyDiff(
  baseContent: string,
  patchStr: string,
  relativePath: string, // For logging context
): string | null {
  if (!patchStr) {
    // If the patch string is empty, it means no changes were recorded
    return baseContent;
  }

  try {
    // Parse the diff and apply it
    const patches = diff.parsePatch(patchStr);
    if (!patches || patches.length === 0) {
      log(
        `Warning: Could not parse patch for ${relativePath}. Returning base content.`,
      );
      return baseContent; // Or handle as error? For now, assume no change.
    }

    // applyPatch can return false if the patch doesn't apply cleanly,
    // or the new content if successful.
    const patchedContent = diff.applyPatch(baseContent, patches[0]);

    if (patchedContent === false) {
      log(
        `Error: Failed to apply patch cleanly for ${relativePath}. The patch might be corrupted or not applicable.`,
      );
      // Decide how to handle: return base, return null, throw error?
      // Returning null indicates we couldn't reconstruct the content.
      return null;
    }

    // applyPatch returns the new file content as a string
    return patchedContent;
  } catch (error) {
    log(`Error applying diff for ${relativePath}: ${error}`);
    // Return null to indicate failure to reconstruct content
    return null;
  }
}
