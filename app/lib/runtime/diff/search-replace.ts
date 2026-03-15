import type { SearchReplaceBlock } from '~/types/actions';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('SearchReplaceDiff');

/**
 * Matching strategies applied in order of decreasing strictness.
 * The pipeline tries each strategy in sequence; the first successful
 * match wins. Every escalation is logged.
 */
export enum MatchingStrategy {
  EXACT = 'exact',
  WHITESPACE_INSENSITIVE = 'whitespace-insensitive',
  INDENTATION_PRESERVING = 'indentation-preserving',
  FUZZY = 'fuzzy',
}

export interface ParseResult {
  blocks: SearchReplaceBlock[];
  errors: string[];
}

export interface MatchResult {
  found: boolean;
  startIndex: number;
  endIndex: number;
  matchedText: string;
  strategy: MatchingStrategy;
}

/**
 * Parser — state machine that extracts SEARCH / REPLACE blocks
 */

enum ParserState {
  OUTSIDE,
  IN_SEARCH,
  IN_REPLACE,
}

const SEARCH_MARKER = '<'.repeat(7) + ' SEARCH';
const SEPARATOR = '='.repeat(7);
const REPLACE_MARKER = '>'.repeat(7) + ' REPLACE';

/**
 * Parse a string containing one or more search-replace diff blocks.
 * Malformed blocks are collected in `errors` without crashing.
 */
export function parseSearchReplaceDiff(content: string): ParseResult {
  const blocks: SearchReplaceBlock[] = [];
  const errors: string[] = [];

  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');

  let state: ParserState = ParserState.OUTSIDE;
  let searchLines: string[] = [];
  let replaceLines: string[] = [];
  let blockStartLine = -1;

  const finishBlock = (): void => {
    const search = joinTrimTrailing(searchLines);

    if (searchLines.length === 0) {
      errors.push(`Block at line ${blockStartLine}: Empty SEARCH section`);

      return;
    }

    const replace = joinTrimTrailing(replaceLines);

    blocks.push({ search, replace });
  };

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (state === ParserState.OUTSIDE) {
      if (trimmed === SEARCH_MARKER) {
        state = ParserState.IN_SEARCH;
        searchLines = [];
        replaceLines = [];
        blockStartLine = i + 1;
      } else if (trimmed === SEPARATOR) {
        errors.push(`Line ${i + 1}: Orphaned separator outside of a SEARCH block`);
      } else if (trimmed === REPLACE_MARKER) {
        errors.push(`Line ${i + 1}: Orphaned REPLACE marker outside of a block`);
      }
    } else if (state === ParserState.IN_SEARCH) {
      if (trimmed === SEPARATOR) {
        state = ParserState.IN_REPLACE;
      } else if (trimmed === REPLACE_MARKER) {
        errors.push(
          `Block at line ${blockStartLine}: Missing separator — SEARCH immediately followed by REPLACE marker`,
        );
        state = ParserState.OUTSIDE;
      } else if (trimmed === SEARCH_MARKER) {
        errors.push(`Block at line ${blockStartLine}: SEARCH block interrupted by another SEARCH at line ${i + 1}`);
        searchLines = [];
        replaceLines = [];
        blockStartLine = i + 1;
      } else {
        searchLines.push(lines[i]);
      }
    } else if (state === ParserState.IN_REPLACE) {
      if (trimmed === REPLACE_MARKER) {
        finishBlock();
        state = ParserState.OUTSIDE;
      } else if (trimmed === SEARCH_MARKER) {
        errors.push(`Block at line ${blockStartLine}: REPLACE block not terminated (new SEARCH at line ${i + 1})`);
        finishBlock();
        searchLines = [];
        replaceLines = [];
        blockStartLine = i + 1;
        state = ParserState.IN_SEARCH;
      } else if (trimmed === SEPARATOR) {
        errors.push(`Block at line ${blockStartLine}: Extra separator inside REPLACE section at line ${i + 1}`);
        replaceLines.push(lines[i]);
      } else {
        replaceLines.push(lines[i]);
      }
    }
  }

  if (state === ParserState.IN_SEARCH) {
    errors.push(`Block at line ${blockStartLine}: SEARCH block not closed (end of input reached)`);
  } else if (state === ParserState.IN_REPLACE) {
    errors.push(`Block at line ${blockStartLine}: REPLACE block not terminated (end of input reached)`);
    finishBlock();
  }

  return { blocks, errors };
}

/**
 * Matching — four strategies tried in order of strictness
 */

const STRATEGY_ORDER: MatchingStrategy[] = [
  MatchingStrategy.EXACT,
  MatchingStrategy.WHITESPACE_INSENSITIVE,
  MatchingStrategy.INDENTATION_PRESERVING,
  MatchingStrategy.FUZZY,
];

/**
 * Try all four matching strategies in order of strictness.
 * Returns the first successful match, logging each escalation.
 */
export function findMatchWithStrategies(content: string, searchText: string): MatchResult {
  for (let i = 0; i < STRATEGY_ORDER.length; i++) {
    const strategy = STRATEGY_ORDER[i];
    const result = findMatch(content, searchText, strategy);

    if (result.found) {
      if (i > 0) {
        logger.debug(`Match found via ${strategy} (escalated from ${STRATEGY_ORDER.slice(0, i).join(', ')})`);
      } else {
        logger.debug('Match found via exact strategy');
      }

      return result;
    }

    if (i < STRATEGY_ORDER.length - 1) {
      logger.debug(`${strategy} strategy failed — escalating to ${STRATEGY_ORDER[i + 1]}`);
    }
  }

  logger.warn('No matching strategy succeeded');

  return noMatch(MatchingStrategy.FUZZY);
}

/** Dispatch to the correct strategy implementation. */
function findMatch(content: string, searchText: string, strategy: MatchingStrategy): MatchResult {
  if (strategy === MatchingStrategy.EXACT) {
    return findExactMatch(content, searchText);
  }

  if (strategy === MatchingStrategy.WHITESPACE_INSENSITIVE) {
    return findWhitespaceInsensitiveMatch(content, searchText);
  }

  if (strategy === MatchingStrategy.INDENTATION_PRESERVING) {
    return findIndentationPreservingMatch(content, searchText);
  }

  return findFuzzyMatch(content, searchText);
}

/**
 * Strategy 1 — Exact match (character-for-character)
 */
function findExactMatch(content: string, searchText: string): MatchResult {
  const index = content.indexOf(searchText);

  if (index === -1) {
    return noMatch(MatchingStrategy.EXACT);
  }

  const secondOccurrence = content.indexOf(searchText, index + 1);

  if (secondOccurrence !== -1) {
    logger.debug('Exact match rejected — search text appears more than once');

    return noMatch(MatchingStrategy.EXACT);
  }

  return {
    found: true,
    startIndex: index,
    endIndex: index + searchText.length,
    matchedText: searchText,
    strategy: MatchingStrategy.EXACT,
  };
}

/**
 * Strategy 2 — Whitespace-insensitive match
 */
function findWhitespaceInsensitiveMatch(content: string, searchText: string): MatchResult {
  const contentLines = content.split('\n');
  const searchLines = searchText.split('\n');

  if (searchLines.length === 0) {
    return noMatch(MatchingStrategy.WHITESPACE_INSENSITIVE);
  }

  const normalizedSearchLines = searchLines.map(normalizeLineWhitespace);
  let matchCount = 0;
  let matchStartIdx = -1;

  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    const candidateLines = contentLines.slice(i, i + searchLines.length);
    const normalizedCandidate = candidateLines.map(normalizeLineWhitespace);

    if (arraysEqual(normalizedCandidate, normalizedSearchLines)) {
      matchCount++;

      if (matchCount === 1) {
        matchStartIdx = i;
      }
    }
  }

  if (matchCount === 0) {
    return noMatch(MatchingStrategy.WHITESPACE_INSENSITIVE);
  }

  if (matchCount > 1) {
    logger.debug('Whitespace-insensitive match rejected — search text matches multiple locations');

    return noMatch(MatchingStrategy.WHITESPACE_INSENSITIVE);
  }

  const matchedLines = contentLines.slice(matchStartIdx, matchStartIdx + searchLines.length);
  const { start, end } = linesToCharBounds(contentLines, matchStartIdx, matchedLines.length);

  return {
    found: true,
    startIndex: start,
    endIndex: end,
    matchedText: matchedLines.join('\n'),
    strategy: MatchingStrategy.WHITESPACE_INSENSITIVE,
  };
}

/**
 * Strategy 3 — Indentation-preserving match
 */
function findIndentationPreservingMatch(content: string, searchText: string): MatchResult {
  const contentLines = content.split('\n');
  const searchLines = searchText.split('\n');

  if (searchLines.length === 0) {
    return noMatch(MatchingStrategy.INDENTATION_PRESERVING);
  }

  const searchStripped = searchLines.map(stripIndent);
  let matchCount = 0;
  let matchStartIdx = -1;

  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    const candidateLines = contentLines.slice(i, i + searchLines.length);
    const candidateStripped = candidateLines.map(stripIndent);

    if (arraysEqual(candidateStripped, searchStripped)) {
      matchCount++;

      if (matchCount === 1) {
        matchStartIdx = i;
      }
    }
  }

  if (matchCount === 0) {
    return noMatch(MatchingStrategy.INDENTATION_PRESERVING);
  }

  if (matchCount > 1) {
    logger.debug('Indentation-preserving match rejected — search text matches multiple locations');

    return noMatch(MatchingStrategy.INDENTATION_PRESERVING);
  }

  const matchedLines = contentLines.slice(matchStartIdx, matchStartIdx + searchLines.length);
  const { start, end } = linesToCharBounds(contentLines, matchStartIdx, matchedLines.length);

  return {
    found: true,
    startIndex: start,
    endIndex: end,
    matchedText: matchedLines.join('\n'),
    strategy: MatchingStrategy.INDENTATION_PRESERVING,
  };
}

/**
 * Strategy 4 — Fuzzy match (line-based similarity >= 80%)
 */

const FUZZY_THRESHOLD = 0.8;

function findFuzzyMatch(content: string, searchText: string): MatchResult {
  const contentLines = content.split('\n');
  const searchLines = searchText.split('\n');

  if (searchLines.length === 0) {
    return noMatch(MatchingStrategy.FUZZY);
  }

  const candidates: { startLine: number; similarity: number }[] = [];

  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    const candidateLines = contentLines.slice(i, i + searchLines.length);
    const similarity = lineLevelSimilarity(candidateLines, searchLines);

    if (similarity >= FUZZY_THRESHOLD) {
      candidates.push({ startLine: i, similarity });
    }
  }

  if (candidates.length === 0) {
    return noMatch(MatchingStrategy.FUZZY);
  }

  if (candidates.length > 1) {
    logger.debug(`Fuzzy match rejected — ${candidates.length} candidate regions exceed threshold (ambiguous)`);

    return noMatch(MatchingStrategy.FUZZY);
  }

  const best = candidates[0];
  const matchedLines = contentLines.slice(best.startLine, best.startLine + searchLines.length);
  const { start, end } = linesToCharBounds(contentLines, best.startLine, matchedLines.length);

  logger.debug(`Fuzzy match accepted — similarity ${(best.similarity * 100).toFixed(1)}%`);

  return {
    found: true,
    startIndex: start,
    endIndex: end,
    matchedText: matchedLines.join('\n'),
    strategy: MatchingStrategy.FUZZY,
  };
}

/**
 * Compute line-level similarity between two equally-sized line arrays.
 * Compares corresponding lines (after whitespace normalization) and returns
 * the ratio of matching lines to total lines.
 */
function lineLevelSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) {
    return 1;
  }

  const total = Math.max(a.length, b.length);
  let matched = 0;

  for (let i = 0; i < total; i++) {
    const lineA = normalizeLineWhitespace(a[i] ?? '');
    const lineB = normalizeLineWhitespace(b[i] ?? '');

    if (lineA === lineB) {
      matched++;
    }
  }

  return matched / total;
}

/**
 * Shared helpers (pure functions — no mutation of inputs)
 */

function noMatch(strategy: MatchingStrategy): MatchResult {
  return { found: false, startIndex: -1, endIndex: -1, matchedText: '', strategy };
}

/** Collapse runs of whitespace to a single space and trim both ends. */
function normalizeLineWhitespace(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

/** Strip all leading whitespace (indentation). */
function stripIndent(line: string): string {
  return line.trimStart();
}

/** Join lines and strip trailing blank lines (no mutation of the input array). */
function joinTrimTrailing(lines: string[]): string {
  return lines.join('\n').replace(/\n+$/, '');
}

/** Check shallow equality of two string arrays. */
function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }

  return true;
}

/**
 * Given an array of all content lines, a start-line index, and a count,
 * return the character-level start/end offsets within the joined content.
 */
function linesToCharBounds(allLines: string[], startLine: number, count: number): { start: number; end: number } {
  let start = 0;

  for (let i = 0; i < startLine; i++) {
    start += allLines[i].length + 1;
  }

  let end = start;

  for (let i = startLine; i < startLine + count; i++) {
    end += allLines[i].length;

    if (i < startLine + count - 1) {
      end += 1;
    }
  }

  return { start, end };
}
