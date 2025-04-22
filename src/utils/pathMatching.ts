import { minimatch } from 'minimatch';

/**
 * Tests whether a file path matches a glob or simple string pattern.
 * @param filePath OS-specific path to a file
 * @param pattern Glob or literal path pattern
 * @param options.allowSubstring If true, allows substring matching (default: false)
 * @param options.minimatchOptions Options passed to minimatch (default: { dot: true })
 * @returns True if the path matches the pattern
 */
export function pathMatchesPattern(
  filePath: string,
  pattern: string,
  options: {
    allowSubstring?: boolean; // Optional with default
    minimatchOptions?: { dot: boolean }; // Optional
  } = {}, // Default empty object
): boolean {
  // Use default values
  const allowSubstring = options.allowSubstring ?? false;
  const minimatchOptions = options.minimatchOptions ?? { dot: true };

  // Normalize path separators
  const normalizedFilePath = filePath.replace(/\\/g, '/');
  const normalizedPattern = pattern.replace(/\\/g, '/');

  // Use minimatch for glob patterns
  if (
    /[*?{}!+@()]/.test(normalizedPattern) ||
    normalizedPattern.includes('**')
  ) {
    return minimatch(normalizedFilePath, normalizedPattern, minimatchOptions);
  }

  // Handle directory pattern (ends with '/')
  if (normalizedPattern.endsWith('/')) {
    return normalizedFilePath.startsWith(normalizedPattern);
  }

  // Exact match
  if (normalizedFilePath === normalizedPattern) {
    return true;
  }

  // Substring match if allowed
  if (allowSubstring && normalizedFilePath.includes(normalizedPattern)) {
    return true;
  }

  return false;
}
