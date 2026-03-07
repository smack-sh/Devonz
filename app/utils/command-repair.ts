import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('CommandRepair');

export interface RepairResult {
  command: string;
  wasRepaired: boolean;
  repairs: string[];
}

interface CommandSegment {
  type: 'command' | 'separator';
  value: string;
}

/**
 * Known binaries that are valid as the first token of a sub-command
 * in a WebContainer (jsh) environment.
 */
const KNOWN_BINARIES = new Set([
  // Package managers
  'npm',
  'npx',
  'pnpm',
  'pnpx',
  'yarn',
  'bun',
  'bunx',

  // Node.js
  'node',
  'deno',
  'tsx',
  'ts-node',

  // Build tools
  'tsc',
  'vite',
  'next',
  'nuxt',
  'esbuild',
  'rollup',
  'webpack',
  'parcel',
  'turbo',
  'svelte-kit',

  // Test/lint tools
  'vitest',
  'jest',
  'mocha',
  'eslint',
  'prettier',
  'stylelint',
  'oxlint',
  'biome',
  'cypress',
  'playwright',

  // Shell builtins & common utilities
  'cd',
  'mkdir',
  'rm',
  'cp',
  'mv',
  'cat',
  'echo',
  'touch',
  'ls',
  'pwd',
  'chmod',
  'chown',
  'ln',
  'env',
  'export',
  'source',
  'which',
  'find',
  'grep',
  'sed',
  'awk',
  'wc',
  'head',
  'tail',
  'sort',
  'uniq',
  'xargs',
  'true',
  'false',
  'test',
  'sleep',
  'date',
  'basename',
  'dirname',
  'readlink',
  'realpath',

  // Other
  'git',
  'curl',
  'wget',
  'tar',
  'unzip',
  'gzip',
  'gunzip',
  'clear',
  'exit',
]);

/**
 * Check if a token looks like a valid command binary.
 *
 * 1. Exact match in KNOWN_BINARIES
 * 2. Starts with `.` or `/` (path-based execution like `./script.sh`)
 * 3. Contains `/` (e.g. `node_modules/.bin/vite`)
 */
function isLikelyBinary(token: string): boolean {
  const lower = token.toLowerCase();

  if (KNOWN_BINARIES.has(lower)) {
    return true;
  }

  // Path-based execution: ./script.sh, ../bin/foo, /usr/bin/node
  if (token.startsWith('.') || token.startsWith('/')) {
    return true;
  }

  // Explicit path: node_modules/.bin/vite (but NOT scoped packages like @types/node)
  if (token.includes('/') && !token.startsWith('@')) {
    return true;
  }

  return false;
}

/**
 * Check if a token looks like an npm package name.
 *
 * Valid: `tailwindcss`, `postcss`, `@types/node`, `@tailwindcss/forms`
 * Invalid: `-D`, `--save`, `./script.sh`, `install`, `&&`
 */
function looksLikePackageName(token: string): boolean {
  return /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(token);
}

/**
 * Split a command string on `&&`, `||`, and `;` operators,
 * preserving the separators as separate segments.
 *
 * e.g. `"npm install && npm run dev"` →
 *   [{ type: 'command', value: 'npm install ' },
 *    { type: 'separator', value: '&& ' },
 *    { type: 'command', value: 'npm run dev' }]
 */
function splitCommandChain(command: string): CommandSegment[] {
  const segments: CommandSegment[] = [];
  const regex = /(\s*(?:&&|\|\||;)\s*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  match = regex.exec(command);

  while (match !== null) {
    // Push the command segment before this separator
    if (match.index > lastIndex) {
      segments.push({ type: 'command', value: command.slice(lastIndex, match.index) });
    }

    // Push the separator
    segments.push({ type: 'separator', value: match[1] });

    lastIndex = regex.lastIndex;
    match = regex.exec(command);
  }

  // Push the remaining command after the last separator
  if (lastIndex < command.length) {
    segments.push({ type: 'command', value: command.slice(lastIndex) });
  }

  return segments;
}

/**
 * Repairs common LLM-generated malformed shell commands.
 *
 * Handles these patterns:
 * 1. Missing `npm` prefix on bare `install`/`i`/`run` commands
 * 2. Missing `yarn` prefix on bare `add` commands
 * 3. Bare npm script names (`dev`, `build`, etc.) → `npm run X`
 * 4. Package-name-only sub-commands → `npm install`
 * 5. Command fusion (e.g. `npx foo -p install -D bar` → split)
 * 6. Empty sub-commands / duplicate separators cleanup
 *
 * This runs AFTER rewriteUnsupportedCommand() and BEFORE #validateShellCommand().
 */
export function repairMalformedCommand(command: string): RepairResult {
  const repairs: string[] = [];
  const segments = splitCommandChain(command.trim());

  if (segments.length === 0) {
    return { command, wasRepaired: false, repairs: [] };
  }

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];

    if (seg.type !== 'command') {
      continue;
    }

    const trimmed = seg.value.trim();

    if (!trimmed) {
      continue;
    }

    const tokens = trimmed.split(/\s+/);
    const firstToken = tokens[0];
    const firstLower = firstToken.toLowerCase();

    /*
     * Rule 1: Bare "install" → "npm install"
     * e.g. `install -D tailwindcss postcss` → `npm install -D tailwindcss postcss`
     */
    if (firstLower === 'install') {
      seg.value = `npm ${trimmed}`;
      repairs.push(`Prepended "npm" to bare "install" command`);
      continue;
    }

    /*
     * Rule 2: Bare "i" with npm-like flags → "npm i"
     * e.g. `i -D tailwindcss` → `npm i -D tailwindcss`
     */
    if (firstLower === 'i' && tokens.length > 1 && tokens.some((t) => /^-[DSg]$|^--save|^--dev/.test(t))) {
      seg.value = `npm ${trimmed}`;
      repairs.push(`Prepended "npm" to bare "i" command`);
      continue;
    }

    /*
     * Rule 3: Bare "add" with arguments → "yarn add"
     * e.g. `add tailwindcss -D` → `yarn add tailwindcss -D`
     */
    if (firstLower === 'add' && tokens.length > 1) {
      seg.value = `yarn ${trimmed}`;
      repairs.push(`Prepended "yarn" to bare "add" command`);
      continue;
    }

    /*
     * Rule 4: Bare "run" → "npm run"
     * e.g. `run dev` → `npm run dev`
     */
    if (firstLower === 'run' && tokens.length > 1) {
      seg.value = `npm ${trimmed}`;
      repairs.push(`Prepended "npm" to bare "run" command`);
      continue;
    }

    /*
     * Rule 5: Bare common npm script names → "npm run X"
     * e.g. `dev` → `npm run dev`
     */
    if (['dev', 'build', 'preview', 'lint', 'format'].includes(firstLower) && tokens.length === 1) {
      seg.value = `npm run ${trimmed}`;
      repairs.push(`Prepended "npm run" to bare "${firstToken}" script`);
      continue;
    }

    /*
     * Rule 6: Sub-command with install flags but no binary prefix
     * e.g. `-D tailwindcss postcss` → `npm install -D tailwindcss postcss`
     *
     * Catches cases where the first token IS a flag (-D, --save-dev, etc.)
     */
    if (/^-[DSg]$|^--save-dev$|^--save$|^--global$/.test(firstToken) && tokens.length >= 2) {
      seg.value = `npm install ${trimmed}`;
      repairs.push(`Prepended "npm install" to bare flags + packages: ${trimmed}`);
      continue;
    }

    /*
     * Rule 7: Unknown binary + all remaining tokens look like package names
     * e.g. `windcss postcss autoprefixer` → `npm install windcss postcss autoprefixer`
     *
     * Conditions:
     * - First token is NOT a known binary
     * - ALL tokens match npm package naming convention
     * - At least 2 tokens (single unknown token could be a non-whitelisted binary)
     */
    if (!isLikelyBinary(firstToken) && tokens.length >= 2) {
      const allLookLikePackages = tokens.every(
        (t) => looksLikePackageName(t) && !['install', 'add', 'run', 'test', 'start'].includes(t.toLowerCase()),
      );

      if (allLookLikePackages) {
        seg.value = `npm install ${trimmed}`;
        repairs.push(`Wrapped package-like tokens in "npm install": ${trimmed}`);
        continue;
      }

      // Tokens include -D / --save-dev flags mixed with package names → likely garbled `npm install`
      const hasInstallFlags = tokens.some((t) => /^-[DSg]$|^--save-dev$|^--save$|^--global$/.test(t));
      const packageTokens = tokens.filter(
        (t) => !t.startsWith('-') && looksLikePackageName(t) && !isLikelyBinary(t.toLowerCase()),
      );

      if (hasInstallFlags && packageTokens.length >= 1) {
        seg.value = `npm install ${trimmed}`;
        repairs.push(`Wrapped tokens with install flags in "npm install": ${trimmed}`);
        continue;
      }
    }

    /*
     * Rule 8: Command fusion detection
     *
     * A valid command starts properly, but then has "install -D ..." or
     * "npm install" fused into the middle/end of it.
     *
     * e.g. `npx tailwindcss init -pm install -D tail`
     *   → `npx tailwindcss init -p && npm install -D tail`
     *
     * Heuristic: if we find "install" token (not as the first word) followed
     * by install-like flags (-D, -S, --save-dev, etc.), split there.
     */
    if (isLikelyBinary(firstToken) && !['npm', 'yarn', 'pnpm', 'bun'].includes(firstLower)) {
      const installIdx = tokens.findIndex(
        (t, idx) =>
          idx > 1 && // Must be at least 3rd token (binary + at least one arg)
          t.toLowerCase() === 'install' &&
          idx + 1 < tokens.length &&
          /^-[DSg]$|^--save|^--dev/.test(tokens[idx + 1]),
      );

      if (installIdx > 0) {
        const beforeInstall = tokens.slice(0, installIdx).join(' ');

        /*
         * Try to clean up: if the token before "install" ends with
         * a letter that was likely part of "npm" (e.g. "-pm" → "-p"),
         * trim the trailing chars that look like they came from "npm install"
         */
        const lastTokenBeforeInstall = tokens[installIdx - 1];
        let cleanedBefore = beforeInstall;

        if (
          lastTokenBeforeInstall &&
          lastTokenBeforeInstall.startsWith('-') &&
          !lastTokenBeforeInstall.startsWith('--')
        ) {
          /*
           * Check if trailing chars of the flag look like they're from "npm"/"m"
           * e.g. "-pm" where "m" is residual from "npm"
           */
          const flagBody = lastTokenBeforeInstall.slice(1); // remove leading '-'
          const cleanedFlag = flagBody.replace(/[nm]+$/i, ''); // strip trailing n/m (from "npm")

          if (cleanedFlag.length > 0 && cleanedFlag !== flagBody) {
            const cleanedLastToken = `-${cleanedFlag}`;
            cleanedBefore = [...tokens.slice(0, installIdx - 1), cleanedLastToken].join(' ');
            repairs.push(`Cleaned flag "${lastTokenBeforeInstall}" → "${cleanedLastToken}" (removed residual chars)`);
          }
        }

        const installPart = `npm ${tokens.slice(installIdx).join(' ')}`;

        seg.value = cleanedBefore;
        segments.splice(i + 1, 0, { type: 'separator', value: ' && ' });
        segments.splice(i + 2, 0, { type: 'command', value: installPart });
        repairs.push(`Split fused command: "${trimmed}" → "${cleanedBefore} && ${installPart}"`);
        continue;
      }
    }
  }

  // Cleanup: remove empty command segments and duplicate separators
  const cleaned: CommandSegment[] = [];

  for (const seg of segments) {
    if (seg.type === 'command' && !seg.value.trim()) {
      continue;
    }

    // Avoid consecutive separators
    if (seg.type === 'separator' && cleaned.length > 0 && cleaned[cleaned.length - 1].type === 'separator') {
      continue;
    }

    cleaned.push(seg);
  }

  // Remove leading/trailing separators
  while (cleaned.length > 0 && cleaned[0].type === 'separator') {
    cleaned.shift();
  }

  while (cleaned.length > 0 && cleaned[cleaned.length - 1].type === 'separator') {
    cleaned.pop();
  }

  if (repairs.length === 0) {
    return { command, wasRepaired: false, repairs: [] };
  }

  const repairedCommand = cleaned.map((s) => s.value).join('');

  logger.info(`Repaired malformed command:`);
  logger.info(`  Original: ${command}`);
  logger.info(`  Repaired: ${repairedCommand}`);

  for (const repair of repairs) {
    logger.info(`  → ${repair}`);
  }

  return { command: repairedCommand, wasRepaired: true, repairs };
}
