import type { SearchReplaceBlock } from '~/types/actions';
import { createScopedLogger } from '~/utils/logger';
import { findMatchWithStrategies, MatchingStrategy } from '~/lib/runtime/diff/search-replace';

const logger = createScopedLogger('SearchReplaceDiff');

export interface ApplyDiffResult {
  result: string;
  appliedCount: number;
  failedBlocks: SearchReplaceBlock[];
}

/**
 * Apply an ordered list of search-replace blocks to file content.
 *
 * Each block is matched using the four-strategy pipeline (exact,
 * whitespace-insensitive, indentation-preserving, fuzzy). When the
 * indentation-preserving strategy is used, the replacement text is
 * re-indented to match the original indentation level.
 *
 * Blocks that cannot be matched are collected in `failedBlocks`
 * instead of throwing. The function never mutates its inputs.
 */
export function applySearchReplaceDiff(originalContent: string, blocks: SearchReplaceBlock[]): ApplyDiffResult {
  let current = originalContent;
  let appliedCount = 0;
  const failedBlocks: SearchReplaceBlock[] = [];

  for (const block of blocks) {
    if (block.search.trim() === '') {
      current = applyEmptySearchBlock(current, block.replace);
      appliedCount++;
      logger.debug('Applied empty-search block (appended content)');

      continue;
    }

    const matchResult = findMatchWithStrategies(current, block.search);

    if (!matchResult.found) {
      logger.warn(`Block not matched — search text starts with: "${block.search.slice(0, 60)}..."`);
      failedBlocks.push(block);

      continue;
    }

    let replacement = block.replace;

    if (matchResult.strategy === MatchingStrategy.INDENTATION_PRESERVING) {
      replacement = reindentReplacement(block.search, block.replace, matchResult.matchedText);
    }

    const before = current.slice(0, matchResult.startIndex);
    const after = current.slice(matchResult.endIndex);

    current = before + replacement + after;
    appliedCount++;

    logger.debug(`Block applied via ${matchResult.strategy} strategy`);
  }

  return { result: current, appliedCount, failedBlocks };
}

/**
 * Handle blocks with empty search text by appending to the end.
 */
function applyEmptySearchBlock(content: string, replacement: string): string {
  if (content === '') {
    return replacement;
  }

  const separator = content.endsWith('\n') ? '' : '\n';

  return content + separator + replacement;
}

/**
 * Re-indent the replacement text so it matches the indentation level
 * found in the actual file content.
 *
 * Computes the indentation delta between what the search block expected
 * and what was actually found, then applies that delta to every line
 * of the replacement.
 */
function reindentReplacement(searchText: string, replaceText: string, matchedText: string): string {
  const searchIndent = getLeadingIndent(searchText);
  const matchedIndent = getLeadingIndent(matchedText);

  if (searchIndent === matchedIndent) {
    return replaceText;
  }

  const searchIndentLen = searchIndent.length;
  const matchedIndentLen = matchedIndent.length;
  const delta = matchedIndentLen - searchIndentLen;

  const replaceLines = replaceText.split('\n');
  const reindented = replaceLines.map((line) => {
    if (line.trim() === '') {
      return line;
    }

    if (delta > 0) {
      return ' '.repeat(delta) + line;
    }

    const lineIndent = getLeadingIndent(line);
    const charsToRemove = Math.min(Math.abs(delta), lineIndent.length);

    return line.slice(charsToRemove);
  });

  return reindented.join('\n');
}

/**
 * Extract the leading whitespace of the first non-empty line.
 */
function getLeadingIndent(text: string): string {
  const lines = text.split('\n');

  for (const line of lines) {
    if (line.trim() !== '') {
      const match = line.match(/^(\s*)/);

      return match ? match[1] : '';
    }
  }

  return '';
}
