import * as diff from 'diff';

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
      console.warn(
        `Warning: Could not parse patch for ${relativePath}. Returning base content.`,
      );
      return baseContent; // Or handle as error? For now, assume no change.
    }

    // applyPatch can return false if the patch doesn't apply cleanly,
    // or the new content if successful.
    const patchedContent = diff.applyPatch(baseContent, patches[0]);

    if (patchedContent === false) {
      console.error(
        `Error: Failed to apply patch cleanly for ${relativePath}. The patch might be corrupted or not applicable.`,
      );
      // Decide how to handle: return base, return null, throw error?
      // Returning null indicates we couldn't reconstruct the content.
      return null;
    }

    // applyPatch returns the new file content as a string
    return patchedContent;
  } catch (error) {
    console.error(`Error applying diff for ${relativePath}:`, error);
    // Return null to indicate failure to reconstruct content
    return null;
  }
}

/**
 * Compare two snapshots and generate a detailed comparison
 */
export interface FileComparison {
  path: string;
  status: 'added' | 'deleted' | 'modified' | 'unchanged';
  diff?: string;
}

/**
 * Generate a human-readable diff summary
 */
export function generateDiffSummary(
  oldContent: string,
  newContent: string,
): {
  additions: number;
  deletions: number;
  changes: number;
} {
  const changes = diff.diffLines(oldContent, newContent);

  let additions = 0;
  let deletions = 0;
  let modifications = 0;

  for (const change of changes) {
    if (change.added) {
      additions += change.count || 0;
    } else if (change.removed) {
      deletions += change.count || 0;
    }
  }

  modifications = Math.min(additions, deletions);

  return {
    additions,
    deletions,
    changes: modifications,
  };
}

/**
 * Format diff for terminal output with colors
 */
export function formatDiffForTerminal(diffString: string): string {
  const lines = diffString.split('\n');
  const formattedLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      formattedLines.push(`\x1b[32m${line}\x1b[0m`); // Green
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      formattedLines.push(`\x1b[31m${line}\x1b[0m`); // Red
    } else if (line.startsWith('@@')) {
      formattedLines.push(`\x1b[36m${line}\x1b[0m`); // Cyan
    } else {
      formattedLines.push(line);
    }
  }

  return formattedLines.join('\n');
}
