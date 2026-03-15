/**
 * Auto-Fix Service
 *
 * Core service that orchestrates the automatic error fixing loop.
 * Receives errors from detectors, formats them for the LLM, and
 * tracks fix attempts. Includes intelligent error classification
 * to provide the LLM with targeted fix instructions.
 */

import { createScopedLogger } from '~/utils/logger';
import {
  autoFixStore,
  getAutoFixStatus,
  getFixHistoryContext,
  markFixComplete,
  markFixFailed,
  resetAutoFix,
  recordFingerprint,
  isFixLoop,
  type ErrorSource,
} from '~/lib/stores/autofix';
import { workbenchStore } from '~/lib/stores/workbench';
import { getRecoverySuggestion } from '~/utils/errors/errorConfig';

const logger = createScopedLogger('AutoFixService');

/**
 * Error context for auto-fix
 */
export interface AutoFixError {
  source: ErrorSource;
  type: string;
  message: string;
  content: string;
}

/**
 * Classified error with actionable context
 */
interface ClassifiedError {
  category: 'import-resolution' | 'syntax' | 'type' | 'runtime' | 'build' | 'port-conflict' | 'unknown';
  missingPackage?: string;
  sourceFile?: string;
  fixInstructions: string;
}

/**
 * Formatted message for sending to chat
 */
export interface AutoFixMessage {
  text: string;
  isAutoFix: true;
  attemptNumber: number;
  maxAttempts: number;
}

/**
 * Classify an error to determine the best fix strategy.
 * Returns structured data including the error category and specific fix instructions.
 *
 * Patterns are ordered from most specific to most generic — first match wins.
 */
function classifyError(error: AutoFixError): ClassifiedError {
  const content = error.content;

  // ─── Pattern: Failed to resolve import "package" from "file" ───
  const importResolutionMatch = content.match(/Failed to resolve import ["']([^"']+)["'] from ["']([^"']+)["']/);

  if (importResolutionMatch) {
    const [, pkg, sourceFile] = importResolutionMatch;

    // Determine if it's an npm package (no ./ or ../ prefix) or a local file
    const isNpmPackage = !pkg.startsWith('.') && !pkg.startsWith('/');
    const packageName = isNpmPackage
      ? pkg
          .split('/')
          .slice(0, pkg.startsWith('@') ? 2 : 1)
          .join('/')
      : undefined;

    if (packageName) {
      return {
        category: 'import-resolution',
        missingPackage: packageName,
        sourceFile,
        fixInstructions: [
          `**Root Cause**: The npm package \`${packageName}\` is imported in \`${sourceFile}\` but is NOT installed.`,
          '',
          '**Required Fix** (do ALL three steps):',
          `1. Add \`"${packageName}": "latest"\` to the \`"dependencies"\` object in \`package.json\` (use a file action, NOT npm install <pkg>)`,
          '2. Run `npm install --legacy-peer-deps` as a shell action',
          '3. Run `npm run dev` as a start action to restart the dev server',
          '',
          '**CRITICAL**: Do NOT modify the import statement in the source file — the import is correct, the package just needs to be installed.',
          '**CRITICAL**: Do NOT rewrite package.json from scratch — only ADD the missing package to the existing dependencies.',
        ].join('\n'),
      };
    }

    // Local file import resolution error
    return {
      category: 'import-resolution',
      sourceFile,
      fixInstructions: [
        `**Root Cause**: The import \`${pkg}\` in \`${sourceFile}\` points to a file that doesn't exist.`,
        '',
        '**Required Fix**:',
        `1. Either create the missing file at the expected path, OR`,
        `2. Fix the import path in \`${sourceFile}\` to point to the correct location`,
        '',
        'Verify the relative path is correct by counting directory levels.',
      ].join('\n'),
    };
  }

  // ─── Pattern: "does not provide an export named 'X'" ───
  const exportNamedMatch = content.match(/does not provide an export named ['"](\w+)['"]/i);

  if (exportNamedMatch) {
    const [, exportName] = exportNamedMatch;
    const sourceFileMatch = content.match(/from ["']([^"']+)["']/);
    const sourceFile = sourceFileMatch?.[1];

    return {
      category: 'import-resolution',
      sourceFile,
      fixInstructions: [
        `**Root Cause**: The module${sourceFile ? ` \`${sourceFile}\`` : ''} does not export \`${exportName}\`.`,
        '',
        '**Required Fix**:',
        `1. Open the source module and check its exports — \`${exportName}\` may be a default export but imported as a named import, or vice versa`,
        `2. If the export name changed, update the import to use the correct name`,
        `3. If the export doesn't exist at all, either add it to the source module or remove the import`,
        '',
        '**Common Mistakes**:',
        '- `import { Component } from "./file"` when the file uses `export default Component` → use `import Component from "./file"`',
        '- Typo in the export name — check capitalization',
      ].join('\n'),
    };
  }

  // ─── Pattern: Cannot find module 'package' ───
  const moduleNotFoundMatch = content.match(/Cannot find module ['"]([^'"]+)['"]/);

  if (moduleNotFoundMatch) {
    const pkg = moduleNotFoundMatch[1];
    const isNpmPackage = !pkg.startsWith('.') && !pkg.startsWith('/');

    if (isNpmPackage) {
      const packageName = pkg
        .split('/')
        .slice(0, pkg.startsWith('@') ? 2 : 1)
        .join('/');

      return {
        category: 'import-resolution',
        missingPackage: packageName,
        fixInstructions: [
          `**Root Cause**: Module \`${packageName}\` is not installed.`,
          '',
          '**Required Fix**:',
          `1. Add \`"${packageName}": "latest"\` to package.json dependencies`,
          '2. Run `npm install --legacy-peer-deps`',
          '3. Restart the dev server with `npm run dev`',
        ].join('\n'),
      };
    }
  }

  // ─── Pattern: Element type is invalid (wrong import/export) ───
  const elementTypeMatch = content.match(/Element type is invalid.*?expected a string.*?but got:?\s*(\w+)/i);

  if (elementTypeMatch) {
    return {
      category: 'runtime',
      fixInstructions: [
        `**Root Cause**: A component is \`${elementTypeMatch[1]}\` — it was imported but doesn't exist at that export path.`,
        '',
        '**Required Fix**:',
        '1. Check the component file — ensure it uses `export default` if the import is `import Name from ...`, or `export { Name }` if the import is `import { Name } from ...`',
        '2. Verify the component file path is correct',
        '3. If the component comes from a library, ensure the package is installed and the import path matches the library docs',
      ].join('\n'),
    };
  }

  // ─── Pattern: "Objects are not valid as a React child" ───
  if (content.includes('Objects are not valid as a React child')) {
    return {
      category: 'runtime',
      fixInstructions: [
        '**Root Cause**: An object or array is being rendered directly in JSX where a string, number, or React element is expected.',
        '',
        '**Required Fix**:',
        '1. If rendering an object, use `JSON.stringify(obj)` or access a specific property like `obj.name`',
        '2. If rendering an array of objects, `.map()` over it and return JSX for each item',
        '3. If rendering a Date, convert it: `date.toLocaleDateString()` or `date.toISOString()`',
        '4. Check your JSX for `{someVariable}` where `someVariable` is an object — it should be a primitive or JSX element',
      ].join('\n'),
    };
  }

  // ─── Pattern: Maximum update depth exceeded (infinite re-render) ───
  if (content.includes('Maximum update depth exceeded')) {
    return {
      category: 'runtime',
      fixInstructions: [
        '**Root Cause**: A component is caught in an infinite re-render loop.',
        '',
        '**Required Fix**:',
        '1. Check for `setState()` calls inside `useEffect` without proper dependencies',
        '2. Check for event handlers that directly call state setters: `onClick={setX(val)}` should be `onClick={() => setX(val)}`',
        '3. Ensure `useEffect` dependency arrays do not include objects/arrays created on each render — extract them to state or useMemo',
        '4. If using `useEffect(() => { setX(...) }, [x])` — this creates a loop. Remove `x` from deps or restructure the logic',
      ].join('\n'),
    };
  }

  // ─── Pattern: Invalid hook call ───
  if (content.includes('Invalid hook call')) {
    return {
      category: 'runtime',
      fixInstructions: [
        '**Root Cause**: React hooks are being called incorrectly.',
        '',
        '**Required Fix** (check ALL of these):',
        '1. Hooks must be called at the TOP LEVEL of a function component — not inside loops, conditions, or nested functions',
        '2. Hooks must only be called from React function components or custom hooks — not from regular JS functions',
        '3. Check for multiple versions of React (`npm ls react` — should show only one)',
        '4. Component names must start with an uppercase letter to be treated as components',
      ].join('\n'),
    };
  }

  // ─── Pattern: React hook context errors (e.g. "useChart must be used within <ChartContainer>") ───
  const hookContextMatch = content.match(/(?:Uncaught Error:\s*)?(\w+)\s+must be used within (?:a\s+)?<(\w+)/);

  if (hookContextMatch) {
    const [, hookName, wrapperComponent] = hookContextMatch;

    return {
      category: 'runtime',
      fixInstructions: [
        `**Root Cause**: The hook \`${hookName}\` requires a \`<${wrapperComponent}>\` ancestor component as a context provider.`,
        '',
        '**Required Fix**:',
        `1. Find the component that calls \`${hookName}()\` or uses a component that internally calls it`,
        `2. Wrap that component (or its chart/content) with \`<${wrapperComponent}>\``,
        `3. If using shadcn/ui charts: wrap recharts components (BarChart, LineChart, etc.) inside \`<ChartContainer config={chartConfig}>\` — NEVER use bare recharts components`,
        '',
        '**Example pattern for shadcn/ui charts**:',
        '```tsx',
        'import { ChartContainer, type ChartConfig } from "@/components/ui/chart"',
        'const config: ChartConfig = { value: { label: "Value", color: "#8884d8" } }',
        '<ChartContainer config={config}>',
        '  <BarChart data={data}><Bar dataKey="value" /></BarChart>',
        '</ChartContainer>',
        '```',
      ].join('\n'),
    };
  }

  // ─── Pattern: "Cannot read properties of undefined/null (reading 'X')" ───
  const cannotReadMatch = content.match(
    /Cannot read propert(?:y|ies) of (?:undefined|null)(?:\s*\(reading ['"](\w+)['"]\))?/i,
  );

  if (cannotReadMatch) {
    const prop = cannotReadMatch[1];

    return {
      category: 'runtime',
      fixInstructions: [
        `**Root Cause**: Trying to access${prop ? ` \`.${prop}\`` : ' a property'} on \`undefined\` or \`null\`.`,
        '',
        '**Required Fix**:',
        '1. Add a null/undefined check before accessing the property: `if (obj) { obj.prop }`',
        '2. Use optional chaining: `obj?.prop` instead of `obj.prop`',
        '3. Check the data flow — the variable may not be initialized yet (common with async data or `useState(undefined)`)',
        '4. If this is from an API response, add a loading state and only render after data is available',
        '5. If this is in a `.map()` or `.filter()`, ensure the array is initialized (default to `[]`)',
      ].join('\n'),
    };
  }

  // ─── Pattern: "X is not defined" reference errors ───
  const referenceErrorMatch = content.match(/(?:ReferenceError|Uncaught ReferenceError):\s*(\w+)\s+is not defined/);

  if (referenceErrorMatch) {
    const [, identifier] = referenceErrorMatch;

    return {
      category: 'runtime',
      fixInstructions: [
        `**Root Cause**: \`${identifier}\` is used but not imported or defined in the current scope.`,
        '',
        '**Required Fix**:',
        `1. Add the missing import statement for \`${identifier}\` at the top of the file`,
        `2. If \`${identifier}\` is a component, import it from the correct path (e.g., \`import { ${identifier} } from '@/components/${identifier.toLowerCase()}'\`)`,
        `3. If \`${identifier}\` is a variable/function, ensure it's defined before use`,
        `4. Check for typos in the variable name`,
      ].join('\n'),
    };
  }

  // ─── Pattern: RangeError ───
  if (content.includes('RangeError')) {
    return {
      category: 'runtime',
      fixInstructions: [
        '**Root Cause**: A value is outside its allowed range (e.g., infinite recursion, invalid array length).',
        '',
        '**Required Fix**:',
        '1. If "Maximum call stack size exceeded" — check for infinite recursion in function calls or component rendering',
        '2. If "Invalid array length" — ensure array sizes are non-negative integers',
        '3. If "Invalid string length" — check string concatenation in loops',
        '4. Add base cases to recursive functions',
      ].join('\n'),
    };
  }

  // ─── Pattern: SyntaxError / parse errors ───
  if (content.includes('SyntaxError') || content.includes('Unexpected token') || content.includes('Parse error')) {
    // Extract file path if available for better context
    const fileMatch = content.match(/(?:in|at|file:)\s*([\w./\\-]+\.(?:tsx?|jsx?|css|json))/i);
    const filePath = fileMatch?.[1];

    return {
      category: 'syntax',
      sourceFile: filePath,
      fixInstructions: [
        `**Root Cause**: Syntax error${filePath ? ` in \`${filePath}\`` : ''}.`,
        '',
        '**Required Fix**:',
        '1. Check for missing or extra brackets `{}`, `()`, `[]`',
        '2. Check for missing semicolons or commas (especially in objects/arrays)',
        '3. Check for unclosed string literals (quotes)',
        '4. In JSX — ensure all tags are properly closed and nested',
        '5. In JSX — use `className` not `class`, and `htmlFor` not `for`',
        '6. Check for invalid characters copied from outside (curly quotes, em dashes)',
      ].join('\n'),
    };
  }

  // ─── Pattern: CSS / PostCSS / Tailwind errors ───
  if (
    content.includes('CssSyntaxError') ||
    content.includes('[plugin:vite:css]') ||
    content.includes('postcss') ||
    content.match(/class.*does not exist/i)
  ) {
    return {
      category: 'build',
      fixInstructions: [
        '**Root Cause**: CSS/PostCSS/Tailwind configuration or syntax error.',
        '',
        '**Required Fix**:',
        '1. If a Tailwind class "does not exist" — check for typos or use only standard Tailwind utility classes',
        '2. If PostCSS error — check `postcss.config.js` and ensure all PostCSS plugins are installed',
        '3. If CSS syntax error — check for missing semicolons, unclosed brackets, or invalid property values',
        '4. Ensure `tailwindcss` is in package.json dependencies and `tailwind.config.js` exists',
      ].join('\n'),
    };
  }

  // ─── Pattern: ENOENT / File not found ───
  const enoentMatch = content.match(/ENOENT.*?no such file or directory.*?['"]?([^\s'"]+)['"]?/i);

  if (enoentMatch) {
    const missingPath = enoentMatch[1];

    return {
      category: 'build',
      fixInstructions: [
        `**Root Cause**: File or directory not found: \`${missingPath}\``,
        '',
        '**Required Fix**:',
        `1. Create the missing file at \`${missingPath}\``,
        '2. Or fix the path reference that points to this file',
        '3. If this is a config file (tsconfig, postcss, tailwind), ensure it exists in the project root',
      ].join('\n'),
    };
  }

  // ─── Pattern: Generic TypeError (catch-all for uncaught TypeError patterns) ───
  if (content.includes('TypeError') || content.includes('is not a function') || content.includes('is not defined')) {
    const functionMatch = content.match(/(\w+)\s+is not a function/);

    return {
      category: 'runtime',
      fixInstructions: [
        `**Root Cause**: ${functionMatch ? `\`${functionMatch[1]}\` is not a function` : 'TypeError — a value was used in an unexpected way'}.`,
        '',
        '**Required Fix**:',
        functionMatch
          ? [
              `1. Check that \`${functionMatch[1]}\` is correctly imported — it may be a default export imported as named, or vice versa`,
              `2. Verify \`${functionMatch[1]}\` actually exists in the module you're importing from`,
              '3. Check if you accidentally call the result of a non-function (e.g., `useState()()`)',
            ].join('\n')
          : [
              '1. Check that all imported values exist and are the right type (function vs. value)',
              '2. Use optional chaining for property access on potentially undefined values',
              '3. Verify you are not calling `.map()` / `.filter()` on a non-array (initialize with `[]`)',
            ].join('\n'),
      ].join('\n'),
    };
  }

  // ─── Pattern: TypeScript errors ───
  if (content.includes('TS2') || content.includes('Type ') || content.includes('type error')) {
    return {
      category: 'type',
      fixInstructions: [
        '**Root Cause**: TypeScript type mismatch.',
        '',
        '**Required Fix**:',
        '1. Read the error carefully — it names the expected type and the actual type',
        '2. If "not assignable to type" — update the value to match the expected type, or update the type annotation',
        '3. If "Property does not exist" — add the missing property to the interface or use optional access',
        '4. If "Argument of type ... is not assignable" — check function parameter types match',
        '5. Avoid using `any` — use proper types or `unknown` with type guards',
      ].join('\n'),
    };
  }

  // ─── Pattern: "Cannot use import statement outside a module" (ESM/CJS mismatch) ───
  if (content.includes('Cannot use import statement outside a module')) {
    return {
      category: 'build',
      fixInstructions: [
        '**Root Cause**: A file uses ES module syntax (`import/export`) but is being loaded as CommonJS.',
        '',
        '**Required Fix**:',
        '1. If using Vite — ensure the file has a `.ts`, `.tsx`, `.mts`, or `.mjs` extension',
        '2. Add `"type": "module"` to `package.json` if the project should use ESM',
        '3. Or convert `import` statements to `require()` / `module.exports` if the file must be CJS',
        '4. In config files (e.g., `tailwind.config.js`), use `.mjs` extension or `module.exports`',
      ].join('\n'),
    };
  }

  // ─── Pattern: Dynamic import / chunk load failures ───
  if (
    content.includes('ChunkLoadError') ||
    content.includes('Loading chunk') ||
    content.includes('Failed to fetch dynamically imported module')
  ) {
    return {
      category: 'build',
      fixInstructions: [
        '**Root Cause**: A dynamic import (`import()` or `React.lazy()`) could not be loaded.',
        '',
        '**Required Fix**:',
        '1. Check that the imported file/module exists at the expected path',
        '2. If using `React.lazy()`, verify the component is default-exported',
        '3. Check for circular imports between the dynamically imported module and its parent',
        '4. Try converting the dynamic import to a static import to identify the real error',
      ].join('\n'),
    };
  }

  // ─── Pattern: Invariant Violation ───
  if (content.includes('Invariant Violation')) {
    return {
      category: 'runtime',
      fixInstructions: [
        '**Root Cause**: An internal assertion (invariant) was violated, usually from React or a library.',
        '',
        '**Required Fix**:',
        '1. Read the message after "Invariant Violation:" — it describes what went wrong',
        '2. Common causes: rendering hooks conditionally, incorrect prop types, missing required context',
        '3. Check the call stack to identify which component triggered the violation',
        '4. If from a library (React Router, Apollo, etc.), check you are using the correct version and API',
      ].join('\n'),
    };
  }

  // ─── Pattern: Build failures (generic catch-all) ───
  if (content.match(/Build failed|error during build/i)) {
    return {
      category: 'build',
      fixInstructions: [
        '**Root Cause**: The build process failed.',
        '',
        '**Required Fix**:',
        '1. Read the error output above carefully — the root cause is usually stated before "Build failed"',
        '2. Common causes: missing imports, type errors, syntax errors, missing dependencies',
        '3. Fix the root cause error first, then the build will succeed',
      ].join('\n'),
    };
  }

  // ─── Pattern: EADDRINUSE (port conflict) ───
  if (/EADDRINUSE|address already in use|port\s+\d+\s+is\s+(?:already\s+)?in\s+use/i.test(content)) {
    const portMatch = content.match(/(?:port\s+|:)(\d+)/i);
    const conflictPort = portMatch?.[1] ?? 'unknown';

    return {
      category: 'port-conflict',
      fixInstructions: [
        `**Root Cause**: Port ${conflictPort} is already in use by another process.`,
        '',
        '**Required Fix**:',
        '1. Do NOT change the application code — the port conflict is an environment issue',
        '2. Restart the dev server with a different port by running: `npm run dev -- --port 3001` as a start action',
        '3. If the error persists, try port 3002, 3003, etc.',
        '',
        '**CRITICAL**: Do NOT rewrite vite.config, next.config, or package.json to hardcode a different port.',
      ].join('\n'),
    };
  }

  return {
    category: 'unknown',
    fixInstructions: [
      '**Root Cause**: Unrecognized error type.',
      '',
      '**Required Fix**:',
      '1. Read the error output carefully and identify the root cause',
      '2. If it mentions a file path, check that file for issues',
      '3. If it mentions a module or package, ensure it is installed',
      '4. If it is a runtime error, add proper error handling and null checks',
    ].join('\n'),
  };
}

/**
 * Format an error for sending to the LLM via chat.
 * Includes intelligent error classification, recovery suggestions,
 * targeted fix instructions, and escalation for repeated failures.
 */
export function formatErrorForLLM(error: AutoFixError): AutoFixMessage {
  const status = getAutoFixStatus();
  const historyContext = getFixHistoryContext();
  const classified = classifyError(error);

  // Determine source label
  const sourceLabel = error.source === 'terminal' ? 'terminal' : error.source === 'preview' ? 'preview' : 'build';

  // Build the message text
  const lines: string[] = [];

  // Header with attempt count
  lines.push(`[Auto-Fix Attempt ${status.currentAttempt}/${status.maxAttempts}]`);
  lines.push('');
  lines.push(`*Automatically fixing ${sourceLabel} error (${classified.category})*`);
  lines.push('');

  // Error details
  lines.push(`**Error Type**: ${error.type}`);
  lines.push(`**Error Category**: ${classified.category}`);

  if (classified.missingPackage) {
    lines.push(`**Missing Package**: \`${classified.missingPackage}\``);
  }

  if (classified.sourceFile) {
    lines.push(`**Source File**: \`${classified.sourceFile}\``);
  }

  lines.push('');
  lines.push('**Error Output**:');
  lines.push('```' + (error.source === 'preview' ? 'js' : 'sh'));
  lines.push(error.content.slice(0, 2000));
  lines.push('```');

  // Add targeted fix instructions based on classification
  lines.push('');
  lines.push('---');
  lines.push(classified.fixInstructions);

  // Add recovery suggestion from centralized errorConfig if available
  const recoverySuggestion = getRecoverySuggestion(error.content);

  if (recoverySuggestion) {
    lines.push('');
    lines.push(`**Additional Context**: ${recoverySuggestion}`);
  }

  // Add history context if there were previous attempts
  if (historyContext) {
    lines.push('');
    lines.push('---');
    lines.push(historyContext);
  }

  // Add escalation for repeated failures — increasingly specific guidance
  if (status.currentAttempt >= 2) {
    lines.push('');
    lines.push('---');
    lines.push('**WARNING**: Previous fix attempts failed. Try a DIFFERENT approach this time.');
    lines.push('');

    if (classified.category === 'import-resolution' && classified.missingPackage) {
      lines.push(
        `Ensure \`${classified.missingPackage}\` is in package.json \`"dependencies"\` AND that \`npm install\` runs successfully.`,
      );
      lines.push('If the package cannot be installed, remove the import and implement the functionality without it.');
    } else if (classified.category === 'runtime') {
      lines.push('**Escalation Steps**:');
      lines.push('1. Re-read the FULL error stack trace — the real cause may be in a different file than expected');
      lines.push(
        '2. If a component keeps failing, try simplifying it — remove complex logic and rebuild incrementally',
      );
      lines.push('3. Check if the error is caused by a missing dependency or wrong import — not just the code logic');
    } else if (classified.category === 'syntax') {
      lines.push('**Escalation Steps**:');
      lines.push('1. Instead of patching, rewrite the problematic file section from scratch');
      lines.push('2. Check for copy-paste artifacts (smart quotes, invisible characters, wrong line endings)');
    } else {
      lines.push('**Escalation Steps**:');
      lines.push('1. Look at the error from a completely different angle — the root cause may not be obvious');
      lines.push('2. Check ALL files mentioned in the error output, not just the first one');
    }

    if (status.currentAttempt >= 3) {
      lines.push('');
      lines.push(
        '**FINAL ATTEMPT**: This is the last try. If the same approach keeps failing, use an entirely different implementation strategy.',
      );
    }
  }

  return {
    text: lines.join('\n'),
    isAutoFix: true,
    attemptNumber: status.currentAttempt,
    maxAttempts: status.maxAttempts,
  };
}

/**
 * Extract missing package name from an import resolution error.
 * Returns the package name if detectable, or undefined.
 */
export function extractMissingPackage(errorContent: string): string | undefined {
  const match = errorContent.match(/Failed to resolve import ["']([^"']+)["']/);

  if (match) {
    const importPath = match[1];

    if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
      return importPath
        .split('/')
        .slice(0, importPath.startsWith('@') ? 2 : 1)
        .join('/');
    }
  }

  const moduleMatch = errorContent.match(/Cannot find module ['"]([^'"]+)['"]/);

  if (moduleMatch) {
    const pkg = moduleMatch[1];

    if (!pkg.startsWith('.') && !pkg.startsWith('/')) {
      return pkg
        .split('/')
        .slice(0, pkg.startsWith('@') ? 2 : 1)
        .join('/');
    }
  }

  return undefined;
}

/**
 * Handle successful fix (no more errors detected after fix)
 * Call this when the error is resolved
 */
export function handleFixSuccess(): void {
  logger.info('Auto-fix successful - error resolved');
  markFixComplete();

  // Clear the terminal/preview error alert since the fix succeeded
  workbenchStore.clearAlert();

  // Optionally show success notification
  const state = autoFixStore.get();

  if (state.settings.showNotifications) {
    // Could trigger a toast notification here
    logger.info('Fix completed successfully');
  }
}

/**
 * Handle failed fix (error still present or new error)
 * Call this when the same/similar error is detected after fix attempt
 */
export function handleFixFailure(): void {
  const status = getAutoFixStatus();
  logger.info(`Auto-fix attempt ${status.currentAttempt} failed`);

  markFixFailed();

  // Check if we should continue
  if (status.currentAttempt >= status.maxAttempts) {
    logger.warn('Max auto-fix attempts reached, stopping');

    // The terminal error detector will now show the alert to user
  }
}

/**
 * Cancel ongoing auto-fix session
 * Call this when user manually intervenes or closes the chat
 */
export function cancelAutoFix(): void {
  logger.info('Auto-fix cancelled by user');
  resetAutoFix();
}

/**
 * Check if auto-fix is currently active
 */
export function isAutoFixActive(): boolean {
  return getAutoFixStatus().isActive;
}

/**
 * Get the current auto-fix attempt number
 */
export function getCurrentAttempt(): number {
  return getAutoFixStatus().currentAttempt;
}

/**
 * Get summary of auto-fix session for display
 */
export function getAutoFixSummary(): string {
  const state = autoFixStore.get();

  if (!state.isFixing && state.fixHistory.length === 0) {
    return 'No auto-fix activity';
  }

  const successCount = state.fixHistory.filter((a) => a.wasSuccessful).length;
  const failCount = state.fixHistory.filter((a) => !a.wasSuccessful).length;

  if (state.isFixing) {
    return `Auto-fixing... (Attempt ${state.currentRetries}/${state.settings.maxRetries})`;
  }

  if (successCount > 0) {
    return `Fixed after ${state.currentRetries} attempt(s)`;
  }

  return `Failed after ${failCount} attempt(s)`;
}

/**
 * Create the auto-fix callback function for the terminal error detector
 * This returns a function that can be registered with the detector
 */
export function createAutoFixHandler(sendMessage: (message: string) => void): (error: AutoFixError) => Promise<void> {
  return async (error: AutoFixError): Promise<void> => {
    logger.info('Auto-fix handler triggered', { type: error.type, source: error.source });

    // Format the error for the LLM
    const formattedMessage = formatErrorForLLM(error);

    // Send the fix request via chat
    sendMessage(formattedMessage.text);
  };
}

// ─── Server-side validation bridge ──────────────────────────────────────────

/**
 * Server-side error validation report, received via SSE error_validation events.
 */
export interface ServerValidationReport {
  category: 'import-resolution' | 'syntax' | 'type' | 'runtime' | 'build' | 'unknown';
  fingerprint: string;
  suggestion: string;
  loopDetected: boolean;
}

/**
 * Receive a server-side error validation report and feed it into the client
 * auto-fix flow. The report is processed through the fingerprint tracker to
 * detect fix loops; if a loop is detected client-side the auto-fix is paused.
 *
 * This function is the server→client bridge: called by the SSE event handler
 * when an `error_validation` event arrives. It does NOT directly mutate the
 * nanostore from server code — it is designed to be called on the client.
 *
 * @returns An object indicating whether the error was accepted for fixing and
 *          whether a fix loop has been detected.
 */
export function receiveServerValidation(report: ServerValidationReport): { accepted: boolean; loopDetected: boolean } {
  logger.info('Received server-side validation', {
    category: report.category,
    fingerprint: report.fingerprint,
    loopDetected: report.loopDetected,
  });

  // Record the fingerprint on the client side regardless of server loop flag
  const { loopDetected: clientLoopDetected } = recordFingerprint(report.fingerprint);

  /*
   * If the server already flagged a loop, or our client-side tracking detects one,
   * the auto-fix should be paused (recordFingerprint handles the pause automatically).
   */
  const effectiveLoop = report.loopDetected || clientLoopDetected;

  if (effectiveLoop) {
    logger.warn(
      `Fix loop detected for fingerprint ${report.fingerprint} (server=${report.loopDetected}, client=${clientLoopDetected})`,
    );

    return { accepted: false, loopDetected: true };
  }

  // Check if a fix loop was already detected for this fingerprint
  if (isFixLoop(report.fingerprint)) {
    logger.debug(`Fingerprint ${report.fingerprint} already in fix loop, rejecting`);

    return { accepted: false, loopDetected: true };
  }

  // No loop — classify locally using the server's suggestion as extra context
  const state = autoFixStore.get();

  if (!state.settings.isEnabled || state.pausedByLoop) {
    logger.debug('Auto-fix disabled or paused, not processing server validation');

    return { accepted: false, loopDetected: false };
  }

  logger.info(`Server validation accepted: ${report.category} — ${report.suggestion.slice(0, 100)}`);

  return { accepted: true, loopDetected: false };
}
