/**
 * Phase-specific prompt templates for the 5-phase code generation pipeline.
 *
 * Each phase has a focused prompt that guides the LLM's behavior:
 *   blueprint → produce a structured project architecture (generateText + Zod)
 *   plan      → decompose the task into steps
 *   scaffold  → generate file/folder structure and interfaces
 *   implement → produce full implementation code
 *   review    → detect errors and suggest fixes
 */

export const PHASE_NAMES = ['blueprint', 'plan', 'scaffold', 'implement', 'review'] as const;
export type PhaseName = (typeof PHASE_NAMES)[number];

export interface PhasePrompt {
  phase: PhaseName;
  systemSuffix: string;
  userPrefix: string;
}

/**
 * Returns the prompt template for the given phase.
 *
 * The `systemSuffix` is appended to the base system prompt before the LLM call.
 * The `userPrefix` is prepended to the latest user message for that phase.
 *
 * @param previousOutput — output from the preceding phase (empty string for the plan phase)
 * @param errorContext   — error details from the review phase, used only for implement retries
 */
export function getPhasePrompt(phase: PhaseName, previousOutput: string, errorContext?: string): PhasePrompt {
  switch (phase) {
    case 'blueprint':
      return {
        phase: 'blueprint',
        systemSuffix: [
          '<phase_instruction phase="blueprint">',
          'You are in the BLUEPRINT phase. Your ONLY job is to produce a structured project architecture document.',
          'Your output will be parsed into a typed schema — follow the field descriptions exactly.',
          '',
          "Analyze the user's request and produce:",
          '',
          '1. **projectName** — A concise, descriptive name for the project.',
          '',
          '2. **structure** — A complete list of every file in the project.',
          '   For each file provide its relative path from the project root and a brief description of its purpose.',
          '   Include configuration files (tsconfig, vite config, package.json), source files, test files,',
          '   type definitions, and any assets. Organize files logically by feature or layer.',
          '',
          '3. **dependencies** — All npm packages the project requires.',
          '   For each dependency provide the package name, an optional semver version constraint,',
          '   a reason explaining why it is needed, and whether it is a devDependency.',
          '   Include both production and development dependencies.',
          '',
          '4. **phases** — An ordered list of implementation phases.',
          '   Each phase has a sequential order number (starting at 1), a short title,',
          '   a detailed description of what the phase accomplishes, and the list of file paths',
          '   created or modified during that phase. Phases must build on each other —',
          '   foundational setup first, then core logic, then features, then polish.',
          '',
          '5. **technicalDecisions** — Key architectural and technology choices.',
          '   For each decision provide the domain area (e.g., "State Management", "Routing"),',
          '   the decision made, and the rationale explaining why this choice was made over alternatives.',
          '',
          'Guidelines:',
          '- Be thorough: every file the project needs must appear in the structure.',
          '- Be specific: vague descriptions like "utility file" are not acceptable.',
          '- Phases should be granular enough that each phase is independently verifiable.',
          '- Technical decisions should cover at least: framework choice, state management,',
          '  styling approach, and data flow.',
          '- Do NOT include example JSON or code snippets — the output schema enforces the format.',
          '</phase_instruction>',
        ].join('\n'),
        userPrefix: '[BLUEPRINT PHASE] Produce a complete project architecture blueprint for the following request:\n',
      };

    case 'plan':
      return {
        phase: 'plan',
        systemSuffix: [
          '<phase_instruction phase="plan">',
          'You are in the PLAN phase. Your ONLY job is to produce a structured, numbered plan.',
          'Analyze the user request and output a step-by-step implementation plan as a numbered markdown list.',
          'Each step must be concrete and actionable (e.g., "Create src/utils/validate.ts with email validation").',
          'Do NOT write code — only list the steps.',
          '</phase_instruction>',
        ].join('\n'),
        userPrefix: '[PLAN PHASE] Create a step-by-step plan for the following request:\n',
      };

    case 'scaffold':
      return {
        phase: 'scaffold',
        systemSuffix: [
          '<phase_instruction phase="scaffold">',
          'You are in the SCAFFOLD phase. You receive the plan from the previous phase.',
          'Generate the file and folder structure: create empty files with correct paths,',
          'define interfaces/types, export stubs, and list dependencies.',
          'Focus on structure and contracts — leave function bodies minimal.',
          '',
          'Plan from previous phase:',
          previousOutput,
          '</phase_instruction>',
        ].join('\n'),
        userPrefix: '[SCAFFOLD PHASE] Based on the plan above, generate the project scaffold:\n',
      };

    case 'implement':
      return {
        phase: 'implement',
        systemSuffix: buildImplementSuffix(previousOutput, errorContext),
        userPrefix: errorContext
          ? '[IMPLEMENT PHASE — ERROR CORRECTION] Fix the errors identified in the review and produce corrected code:\n'
          : '[IMPLEMENT PHASE] Based on the scaffold above, produce the full implementation:\n',
      };

    case 'review':
      return {
        phase: 'review',
        systemSuffix: [
          '<phase_instruction phase="review">',
          'You are in the REVIEW phase. You receive the implemented code from the previous phase.',
          'Check for:',
          '  1. Syntax errors, missing imports, or undefined references',
          '  2. Logic errors or incorrect API usage',
          '  3. Missing error handling or edge cases',
          '  4. Inconsistencies between files (wrong export names, mismatched types)',
          '',
          'If NO errors are found, respond with exactly: __review_pass__',
          'If errors ARE found, list each error with:',
          '  - File path',
          '  - Error description',
          '  - Suggested fix',
          '',
          'Implementation from previous phase:',
          previousOutput,
          '</phase_instruction>',
        ].join('\n'),
        userPrefix: '[REVIEW PHASE] Review the implementation above for errors:\n',
      };

    default: {
      const _exhaustive: never = phase;
      throw new Error(`Unknown phase: ${_exhaustive}`);
    }
  }
}

function buildImplementSuffix(previousOutput: string, errorContext?: string): string {
  const lines = ['<phase_instruction phase="implement">', 'You are in the IMPLEMENT phase.'];

  if (errorContext) {
    lines.push(
      'A previous implementation was reviewed and errors were found.',
      'You MUST fix all listed errors while preserving correct parts of the code.',
      '',
      'Errors to fix:',
      errorContext,
      '',
      'Previous implementation (fix the errors in this):',
      previousOutput,
    );
  } else {
    lines.push(
      'You receive the scaffold from the previous phase.',
      'Produce complete, production-ready implementations for every file.',
      'Fill in all function bodies, add error handling, and ensure all imports are correct.',
      '',
      'Scaffold from previous phase:',
      previousOutput,
    );
  }

  lines.push('</phase_instruction>');

  return lines.join('\n');
}
