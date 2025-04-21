import { minimatch } from 'minimatch';

// utils/pathMatching.ts
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
