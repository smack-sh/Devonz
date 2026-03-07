/**
 * Lightweight fuzzy matching utilities for template name resolution.
 *
 * When the LLM returns a template name that doesn't exactly match any
 * known template (e.g. "vite-shadcn" instead of "Vite Shadcn"), these
 * helpers find the closest match so we avoid falling back to a blank template.
 */

/**
 * Classic Levenshtein edit-distance between two strings.
 * Returns the minimum number of single-character edits
 * (insertions, deletions, substitutions) to transform `a` into `b`.
 */
export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Normalised string similarity between 0 (no match) and 1 (identical).
 * Based on Levenshtein distance relative to the longer string length.
 */
export function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);

  if (maxLen === 0) {
    return 1;
  }

  return 1 - levenshteinDistance(a, b) / maxLen;
}

/**
 * Find the best fuzzy match for `query` within `candidates`.
 *
 * Matching strategy (in priority order):
 * 1. Exact match (case-insensitive)
 * 2. Substring containment (either direction, case-insensitive)
 * 3. Highest Levenshtein similarity above `threshold`
 *
 * @returns The best matching candidate name, or `null` if nothing is close enough.
 */
export function findBestMatch(query: string, candidates: string[], threshold = 0.4): string | null {
  if (!query || candidates.length === 0) {
    return null;
  }

  const queryLower = query.toLowerCase().trim();

  // 1. Exact match (case-insensitive)
  const exact = candidates.find((c) => c.toLowerCase().trim() === queryLower);

  if (exact) {
    return exact;
  }

  // 2. Substring containment (prefer shorter names that are fully contained)
  const substringMatches = candidates.filter((c) => {
    const cLower = c.toLowerCase().trim();
    return cLower.includes(queryLower) || queryLower.includes(cLower);
  });

  if (substringMatches.length === 1) {
    return substringMatches[0];
  }

  if (substringMatches.length > 1) {
    // Pick the one with highest similarity to break ties
    let best = substringMatches[0];
    let bestScore = similarity(queryLower, best.toLowerCase());

    for (let i = 1; i < substringMatches.length; i++) {
      const score = similarity(queryLower, substringMatches[i].toLowerCase());

      if (score > bestScore) {
        bestScore = score;
        best = substringMatches[i];
      }
    }

    return best;
  }

  // 3. Levenshtein similarity — find closest match above threshold
  let bestCandidate: string | null = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    const score = similarity(queryLower, candidate.toLowerCase().trim());

    if (score > bestScore && score >= threshold) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  return bestCandidate;
}
