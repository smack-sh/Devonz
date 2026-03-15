/**
 * 4-Phase Code Generation Pipeline
 *
 * Orchestrates LLM calls through: plan → scaffold → implement → review
 * with error-correction retries on the implement phase (max 2 retries).
 *
 * Each phase uses the model router (resolveModelForOperation) to select
 * the optimal model for the task type. Phase progress events are emitted
 * into the SSE stream via special `__phase:<name>` tokens.
 */

import {
  streamText as _streamText,
  generateText,
  Output,
  convertToCoreMessages,
  UnsupportedFunctionalityError,
  NoObjectGeneratedError,
  type Message,
} from 'ai';
import { createScopedLogger } from '~/utils/logger';
import { resolveModelForOperation, type ModelRoutingConfig } from './model-router';
import { getPhasePrompt, PHASE_NAMES, type PhaseName } from '~/lib/common/prompts/phase-prompts';
import type { OperationType } from './model-router';
import type { ErrorValidationEvent } from '~/types/streaming-events';
import { blueprintSchema, type Blueprint } from '~/types/blueprint';
import { OPERATION_TOKEN_BUDGETS, type FileMap } from './constants';
import { selectContext } from './select-context';
import type { IProviderSetting } from '~/types/model';

const logger = createScopedLogger('PhasePipeline');

/** Maximum number of implement → review correction cycles. */
const MAX_CORRECTION_RETRIES = 2;

/** Special token prefix for phase progress events in the SSE stream. */
const PHASE_EVENT_PREFIX = '__phase:';

/**
 * Prefix used to tag blueprint context messages injected into the messages array.
 * api.chat.ts adds a message with this prefix; runPhasePipeline extracts and removes it.
 */
export const BLUEPRINT_CONTEXT_PREFIX = '__BLUEPRINT_CONTEXT__\n';

/** Sentinel the review phase emits when no errors are found. */
const REVIEW_PASS_SENTINEL = '__review_pass__';

// ─── Server-side error classification ──────────────────────────────────────────

type ErrorCategory = 'import-resolution' | 'syntax' | 'type' | 'runtime' | 'build' | 'unknown';

interface ClassifiedReviewError {
  category: ErrorCategory;
  fingerprint: string;
  suggestion: string;
}

/**
 * FNV-1a 32-bit hash — produces a stable hex fingerprint.
 */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;

  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Classify review-phase error output into a category with a targeted fix suggestion.
 * Mirrors the client-side classifyError patterns from autoFixService.ts.
 * Returns classification + a stable fingerprint for loop detection.
 */
function classifyReviewError(errorOutput: string): ClassifiedReviewError {
  const trimmed = errorOutput.trim().slice(0, 2000);

  // ─── Import resolution ───
  if (
    /Failed to resolve import/i.test(trimmed) ||
    /Cannot find module/i.test(trimmed) ||
    /does not provide an export named/i.test(trimmed)
  ) {
    return {
      category: 'import-resolution',
      fingerprint: fnv1a(`import-resolution::${trimmed.slice(0, 200)}`),
      suggestion:
        'Check that all imported modules exist and are installed. ' +
        'Verify import paths and export names match the source modules.',
    };
  }

  // ─── Syntax ───
  if (/SyntaxError/i.test(trimmed) || /Unexpected token/i.test(trimmed) || /Parse error/i.test(trimmed)) {
    return {
      category: 'syntax',
      fingerprint: fnv1a(`syntax::${trimmed.slice(0, 200)}`),
      suggestion:
        'Fix syntax errors: check for missing brackets, unclosed strings, ' +
        'invalid JSX nesting, or stray characters.',
    };
  }

  // ─── Type errors ───
  if (/TS2\d{3}/i.test(trimmed) || /Type .* is not assignable/i.test(trimmed) || /type error/i.test(trimmed)) {
    return {
      category: 'type',
      fingerprint: fnv1a(`type::${trimmed.slice(0, 200)}`),
      suggestion:
        'Resolve TypeScript type mismatches. Read the expected vs actual types ' +
        'and update either the value or the type annotation.',
    };
  }

  // ─── Runtime ───
  if (
    /TypeError/i.test(trimmed) ||
    /ReferenceError/i.test(trimmed) ||
    /RangeError/i.test(trimmed) ||
    /Cannot read propert/i.test(trimmed) ||
    /is not a function/i.test(trimmed) ||
    /is not defined/i.test(trimmed) ||
    /Maximum update depth exceeded/i.test(trimmed) ||
    /Invalid hook call/i.test(trimmed) ||
    /Invariant Violation/i.test(trimmed)
  ) {
    return {
      category: 'runtime',
      fingerprint: fnv1a(`runtime::${trimmed.slice(0, 200)}`),
      suggestion:
        'Fix runtime error: check for null/undefined access, missing function definitions, ' +
        'incorrect hook usage, or infinite re-render loops.',
    };
  }

  // ─── Build ───
  if (
    /Build failed/i.test(trimmed) ||
    /error during build/i.test(trimmed) ||
    /ENOENT/i.test(trimmed) ||
    /CssSyntaxError/i.test(trimmed) ||
    /ChunkLoadError/i.test(trimmed) ||
    /Cannot use import statement outside a module/i.test(trimmed)
  ) {
    return {
      category: 'build',
      fingerprint: fnv1a(`build::${trimmed.slice(0, 200)}`),
      suggestion:
        'Fix build error: check missing files, CSS syntax, import/export format, ' +
        'and module resolution configuration.',
    };
  }

  // ─── Unknown ───
  return {
    category: 'unknown',
    fingerprint: fnv1a(`unknown::${trimmed.slice(0, 200)}`),
    suggestion: 'Read the error output carefully, identify the root cause, and fix it.',
  };
}

/**
 * Maps each pipeline phase to the model-router operation type so that
 * resolveModelForOperation can pick the best model per phase.
 */
const PHASE_TO_OPERATION: Record<PhaseName, OperationType> = {
  blueprint: 'blueprint',
  plan: 'planning',
  scaffold: 'code_generation',
  implement: 'code_generation',
  review: 'error_correction',
};

// ─── Public types ───────────────────────────────────────────────────────────

export interface PhasePipelineOptions {
  /** The resolved model-provider getter — called once per phase. */
  getModelInstance: (provider: string, model: string) => ReturnType<any>;

  /** User's per-operation model routing overrides. */
  modelRoutingConfig: ModelRoutingConfig | undefined | null;

  /** Default provider name from the current chat session. */
  defaultProvider: string;

  /** Default model name from the current chat session. */
  defaultModel: string;

  /** The base system prompt (before phase suffixes). */
  systemPrompt: string;

  /** Chat messages up to (and including) the current user request. */
  messages: Omit<Message, 'id'>[];

  /** Optional token limit forwarded to streamText calls. */
  maxTokens?: number;

  /**
   * Optional compact-serialized blueprint from a prior generateBlueprint call.
   * When present, injected into the plan phase system prompt so the plan is
   * blueprint-informed rather than generic.
   */
  blueprintContext?: string;
}

export interface PhasePipelineResult {
  /** Concatenated final output from the last successful implement phase. */
  output: string;

  /** Number of error-correction retries that were executed (0–2). */
  correctionRetries: number;

  /** Whether the review ultimately passed. */
  reviewPassed: boolean;

  /** Per-phase outputs for debugging / logging. */
  phaseOutputs: Record<PhaseName, string>;

  /** Error validation events emitted during the review phase (for SSE forwarding). */
  errorValidationEvents: ErrorValidationEvent[];
}

// ─── Blueprint generation types ─────────────────────────────────────────────

export type BlueprintError =
  | { code: 'MODEL_RESOLUTION_FAILED'; message: string }
  | { code: 'STRUCTURED_OUTPUT_FAILED'; message: string }
  | { code: 'FALLBACK_PARSE_FAILED'; message: string; raw: string }
  | { code: 'FALLBACK_VALIDATION_FAILED'; message: string; issues: string[] }
  | { code: 'GENERATION_FAILED'; message: string }
  | { code: 'CONTEXT_SELECTION_FAILED'; message: string };

export type BlueprintResult = { success: false; error: BlueprintError } | { success: true; blueprint: Blueprint };

export interface GenerateBlueprintOptions {
  /** The resolved model-provider getter — called once with the routed provider/model. */
  getModelInstance: (provider: string, model: string) => ReturnType<any>;

  /** User's per-operation model routing overrides. */
  modelRoutingConfig: ModelRoutingConfig | undefined | null;

  /** Default provider name from the current chat session. */
  defaultProvider: string;

  /** Default model name from the current chat session. */
  defaultModel: string;

  /** The base system prompt (before blueprint phase suffix). */
  systemPrompt: string;

  /** Chat messages up to (and including) the current user request. */
  messages: Message[];

  /** Project files for context selection. */
  files: FileMap;

  /** Server environment (Cloudflare bindings etc.). */
  env?: Env;

  /** API keys for LLM providers. */
  apiKeys?: Record<string, string>;

  /** Per-provider settings. */
  providerSettings?: Record<string, IProviderSetting>;

  /** Chat summary for context selection. */
  summary?: string;
}

// ─── Blueprint generation ───────────────────────────────────────────────────

/**
 * Generates a project blueprint using Vercel AI SDK's generateText with
 * Zod structured output.
 *
 * Primary path: uses `experimental_output: Output.object({ schema })` for
 * providers that support structured output (tool-use / JSON mode).
 *
 * Fallback path: when the provider does not support structured output,
 * calls generateText without the output spec, extracts JSON from the
 * text response, and validates it with `blueprintSchema.safeParse()`.
 *
 * @returns A Result discriminated union — never throws.
 */
export async function generateBlueprint(options: GenerateBlueprintOptions): Promise<BlueprintResult> {
  const {
    getModelInstance,
    modelRoutingConfig,
    defaultProvider,
    defaultModel,
    systemPrompt,
    messages,
    files,
    env,
    apiKeys,
    providerSettings,
    summary = '',
  } = options;

  // ── Resolve model for the 'blueprint' operation ──
  const resolved = resolveModelForOperation('blueprint', modelRoutingConfig, defaultProvider, defaultModel);
  logger.info(`Blueprint generation → ${resolved.provider}/${resolved.model}`);

  let model: ReturnType<typeof getModelInstance>;

  try {
    model = getModelInstance(resolved.provider, resolved.model);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to resolve model for blueprint: ${message}`);

    return { success: false, error: { code: 'MODEL_RESOLUTION_FAILED', message } };
  }

  // ── Select context with operationType='blueprint' ──
  const tokenBudget = OPERATION_TOKEN_BUDGETS.blueprint;
  let contextString = '';

  try {
    const selectedFiles = await selectContext({
      messages,
      env,
      apiKeys,
      files,
      providerSettings,
      summary,
      operationType: 'blueprint',
    });

    if (selectedFiles && typeof selectedFiles === 'object') {
      const fileEntries = Object.entries(selectedFiles)
        .filter(([, dirent]) => dirent && dirent.type === 'file')
        .map(([path, dirent]) => `--- ${path} ---\n${(dirent as { content: string }).content}`)
        .join('\n\n');

      if (fileEntries) {
        contextString = `\n\nExisting project files for reference:\n${fileEntries}`;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`Context selection failed for blueprint, proceeding without context: ${message}`);
  }

  // ── Build prompts ──
  const phasePrompt = getPhasePrompt('blueprint', '', undefined);
  const fullSystemPrompt = `${systemPrompt}\n\n${phasePrompt.systemSuffix}${contextString}`;

  // Prepend the blueprint user prefix to the last user message
  const augmentedMessages = augmentLastUserMessage(messages, phasePrompt.userPrefix);

  // ── Primary path: structured output ──
  try {
    logger.info('Attempting structured output (primary path)');

    const result = await generateText({
      model,
      system: fullSystemPrompt,
      messages: convertToCoreMessages(augmentedMessages as Omit<Message, 'id'>[]),
      maxTokens: tokenBudget.outputTokens,
      experimental_output: Output.object({ schema: blueprintSchema }),
    });

    const blueprint = result.experimental_output;
    logger.info(`Blueprint generated successfully via structured output: "${blueprint.projectName}"`);

    return { success: true, blueprint };
  } catch (primaryError) {
    // Check if the error indicates structured output is unsupported
    const isUnsupported =
      UnsupportedFunctionalityError.isInstance(primaryError) || NoObjectGeneratedError.isInstance(primaryError);

    if (!isUnsupported) {
      // Unexpected error — not a structured output compatibility issue
      const message = primaryError instanceof Error ? primaryError.message : String(primaryError);
      logger.error(`Structured output generation failed unexpectedly: ${message}`);

      return { success: false, error: { code: 'STRUCTURED_OUTPUT_FAILED', message } };
    }

    logger.warn('Provider does not support structured output — falling back to text + parse');
  }

  // ── Fallback path: text generation + JSON parse + Zod validation ──
  try {
    logger.info('Attempting fallback path (text generation + manual JSON parse)');

    const fallbackResult = await generateText({
      model,
      system: `${fullSystemPrompt}\n\nIMPORTANT: You MUST respond with valid JSON only. No markdown fences, no explanation — raw JSON object matching the blueprint schema.`,
      messages: convertToCoreMessages(augmentedMessages as Omit<Message, 'id'>[]),
      maxTokens: tokenBudget.outputTokens,
    });

    const rawText = fallbackResult.text.trim();

    // Strip markdown code fences if present
    const jsonText = rawText.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');

    let parsed: unknown;

    try {
      parsed = JSON.parse(jsonText);
    } catch {
      logger.error(`Fallback: failed to parse JSON from LLM response (length=${rawText.length})`);

      return {
        success: false,
        error: {
          code: 'FALLBACK_PARSE_FAILED',
          message: 'LLM response is not valid JSON',
          raw: rawText.slice(0, 500),
        },
      };
    }

    // Validate with Zod
    const validation = blueprintSchema.safeParse(parsed);

    if (!validation.success) {
      const issues = validation.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      logger.error(`Fallback: Zod validation failed with ${issues.length} issue(s)`);

      return {
        success: false,
        error: {
          code: 'FALLBACK_VALIDATION_FAILED',
          message: `Blueprint validation failed: ${issues.join('; ')}`,
          issues,
        },
      };
    }

    logger.info(`Blueprint generated successfully via fallback path: "${validation.data.projectName}"`);

    return { success: true, blueprint: validation.data };
  } catch (fallbackError) {
    const message = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
    logger.error(`Fallback blueprint generation failed: ${message}`);

    return { success: false, error: { code: 'GENERATION_FAILED', message } };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extracts the full text from a Vercel AI SDK streamText result.
 * Consumes the async text stream and returns the concatenated string.
 */
async function consumeStream(stream: { textStream: AsyncIterable<string> }): Promise<string> {
  const chunks: string[] = [];

  for await (const chunk of stream.textStream) {
    chunks.push(chunk);
  }

  return chunks.join('');
}

/**
 * Resolves the model for a given phase via the model router.
 */
function resolvePhaseModel(
  phase: PhaseName,
  modelRoutingConfig: ModelRoutingConfig | undefined | null,
  defaultProvider: string,
  defaultModel: string,
) {
  const operationType = PHASE_TO_OPERATION[phase];
  const resolved = resolveModelForOperation(operationType, modelRoutingConfig, defaultProvider, defaultModel);
  logger.info(`Phase "${phase}" → operation "${operationType}" → ${resolved.provider}/${resolved.model}`);

  return resolved;
}

/**
 * Determines whether the review output indicates errors were found.
 * Returns `true` when the review passed (no errors).
 */
function isReviewPass(reviewOutput: string): boolean {
  return reviewOutput.trim().includes(REVIEW_PASS_SENTINEL);
}

// ─── Pipeline runner ────────────────────────────────────────────────────────

/**
 * Runs the 4-phase generation pipeline and returns a {@link PhasePipelineResult}.
 *
 * The caller (stream-text.ts) is responsible for writing the phase-event tokens
 * and the final output into the SSE response stream. This function is intentionally
 * non-streaming: each phase runs to completion so its output can feed the next phase.
 *
 * @throws only on unrecoverable errors (e.g., model resolution failure).
 */
export async function runPhasePipeline(options: PhasePipelineOptions): Promise<PhasePipelineResult> {
  const { getModelInstance, modelRoutingConfig, defaultProvider, defaultModel, systemPrompt, maxTokens } = options;

  // ── Extract blueprint context from messages (if injected by api.chat.ts) ──
  const { cleanMessages, blueprintContext: msgBlueprintCtx } = extractBlueprintFromMessages([...options.messages]);
  const blueprintContext = options.blueprintContext ?? msgBlueprintCtx;
  const messages = cleanMessages;

  if (blueprintContext) {
    logger.info('Blueprint context detected — plan phase will be blueprint-informed');
  }

  const phaseOutputs: Record<string, string> = {
    plan: '',
    scaffold: '',
    implement: '',
    review: '',
  };

  let previousOutput = '';

  // ── Phase 1: Plan (blueprint-informed when context is available) ────────
  const planSystemPrompt = blueprintContext
    ? `${systemPrompt}\n\n<blueprint_context>\nA project blueprint was generated in a prior analysis phase. Use it to inform your plan — ensure the plan covers all blueprint phases, respects the technical decisions, and references the file structure.\n\n${blueprintContext}\n</blueprint_context>`
    : systemPrompt;

  logger.info('Starting phase: plan');
  previousOutput = await runPhase('plan', previousOutput, undefined, {
    getModelInstance,
    modelRoutingConfig,
    defaultProvider,
    defaultModel,
    systemPrompt: planSystemPrompt,
    messages,
    maxTokens,
  });
  phaseOutputs.plan = previousOutput;

  // ── Phase 2: Scaffold ──────────────────────────────────────────────────
  logger.info('Starting phase: scaffold');
  previousOutput = await runPhase('scaffold', previousOutput, undefined, {
    getModelInstance,
    modelRoutingConfig,
    defaultProvider,
    defaultModel,
    systemPrompt,
    messages,
    maxTokens,
  });
  phaseOutputs.scaffold = previousOutput;

  // ── Phase 3 + 4: Implement → Review (with correction loop) ────────────
  let correctionRetries = 0;
  let reviewPassed = false;
  let implementOutput = '';
  let errorContext: string | undefined;
  const errorValidationEvents: ErrorValidationEvent[] = [];

  /**
   * Track fingerprints seen across retries for server-side loop detection.
   * Key = fingerprint, value = number of times seen.
   */
  const seenFingerprints: Record<string, number> = {};

  for (let attempt = 0; attempt <= MAX_CORRECTION_RETRIES; attempt++) {
    // Implement
    logger.info(`Starting phase: implement (attempt ${attempt + 1}/${MAX_CORRECTION_RETRIES + 1})`);
    implementOutput = await runPhase('implement', attempt === 0 ? previousOutput : implementOutput, errorContext, {
      getModelInstance,
      modelRoutingConfig,
      defaultProvider,
      defaultModel,
      systemPrompt,
      messages,
      maxTokens,
    });
    phaseOutputs.implement = implementOutput;

    // Review
    logger.info('Starting phase: review');

    const reviewOutput = await runPhase('review', implementOutput, undefined, {
      getModelInstance,
      modelRoutingConfig,
      defaultProvider,
      defaultModel,
      systemPrompt,
      messages,
      maxTokens,
    });
    phaseOutputs.review = reviewOutput;

    if (isReviewPass(reviewOutput)) {
      reviewPassed = true;
      logger.info('Review passed — no errors detected.');
      break;
    }

    // ── Classify the review errors and track fingerprints ──
    const classified = classifyReviewError(reviewOutput);
    const fpCount = (seenFingerprints[classified.fingerprint] ?? 0) + 1;
    seenFingerprints[classified.fingerprint] = fpCount;

    const loopDetected = fpCount >= 2;

    // Emit error_validation SSE event
    const validationEvent: ErrorValidationEvent = {
      type: 'error_validation',
      timestamp: new Date().toISOString(),
      category: classified.category,
      fingerprint: classified.fingerprint,
      suggestion: classified.suggestion,
      loopDetected,
    };
    errorValidationEvents.push(validationEvent);

    logger.info(
      `Review classified error: category=${classified.category}, fingerprint=${classified.fingerprint}, loop=${loopDetected}`,
    );

    // If a loop is detected, break early — the same error keeps recurring
    if (loopDetected) {
      logger.warn(
        `Loop detected: fingerprint ${classified.fingerprint} seen ${fpCount} times across retries. Breaking correction loop.`,
      );
      break;
    }

    // Errors found — prepare for correction retry
    if (attempt < MAX_CORRECTION_RETRIES) {
      correctionRetries++;
      errorContext = reviewOutput;
      logger.warn(`Review found errors. Correction retry ${correctionRetries}/${MAX_CORRECTION_RETRIES}.`);
    } else {
      logger.warn('Max correction retries reached. Returning best-effort implementation.');
    }
  }

  return {
    output: implementOutput,
    correctionRetries,
    reviewPassed,
    phaseOutputs: phaseOutputs as Record<PhaseName, string>,
    errorValidationEvents,
  };
}

/**
 * Builds the phase-event token string for SSE emission.
 * E.g. `__phase:plan`, `__phase:scaffold`
 */
export function buildPhaseEvent(phase: PhaseName): string {
  return `${PHASE_EVENT_PREFIX}${phase}`;
}

/**
 * Returns the ordered list of phase names.
 */
export function getPhaseNames(): readonly PhaseName[] {
  return PHASE_NAMES;
}

// ─── Blueprint context utilities ────────────────────────────────────────────

/**
 * Produces a compact markdown serialization of a Blueprint object.
 * Designed for injection into the plan phase system prompt — keeps token count
 * low while preserving all actionable information.
 */
export function serializeBlueprintCompact(blueprint: Blueprint): string {
  const lines: string[] = [];

  lines.push(`# Blueprint: ${blueprint.projectName}`);

  // File structure — one line per file
  lines.push('\n## Files');

  for (const f of blueprint.structure) {
    lines.push(`- ${f.path}: ${f.purpose}`);
  }

  // Dependencies — compact format
  if (blueprint.dependencies.length > 0) {
    lines.push('\n## Dependencies');

    for (const d of blueprint.dependencies) {
      const ver = d.version ? `@${d.version}` : '';
      const dev = d.isDev ? ' (dev)' : '';
      lines.push(`- ${d.name}${ver}${dev}: ${d.reason}`);
    }
  }

  // Implementation phases — numbered
  lines.push('\n## Phases');

  for (const p of blueprint.phases) {
    lines.push(`${p.order}. **${p.title}**: ${p.description} [${p.files.join(', ')}]`);
  }

  // Technical decisions — area: decision
  if (blueprint.technicalDecisions.length > 0) {
    lines.push('\n## Decisions');

    for (const td of blueprint.technicalDecisions) {
      lines.push(`- **${td.area}**: ${td.decision} — ${td.rationale}`);
    }
  }

  return lines.join('\n');
}

/**
 * Scans the messages array for a blueprint context message (tagged with
 * BLUEPRINT_CONTEXT_PREFIX) and extracts the context string.
 *
 * Returns the original messages (minus the blueprint tag message) and
 * the extracted blueprint context, or undefined if none found.
 */
function extractBlueprintFromMessages(messages: Omit<Message, 'id'>[]): {
  cleanMessages: Omit<Message, 'id'>[];
  blueprintContext: string | undefined;
} {
  let blueprintContext: string | undefined;
  const cleanMessages: Omit<Message, 'id'>[] = [];

  for (const msg of messages) {
    if (
      !blueprintContext &&
      msg.role === 'assistant' &&
      typeof msg.content === 'string' &&
      msg.content.startsWith(BLUEPRINT_CONTEXT_PREFIX)
    ) {
      blueprintContext = msg.content.slice(BLUEPRINT_CONTEXT_PREFIX.length).trim();
      continue; // Remove the tag message from the cleaned array
    }

    cleanMessages.push(msg);
  }

  return { cleanMessages, blueprintContext };
}

// ─── Internal: run a single phase ───────────────────────────────────────────

interface RunPhaseInternals {
  getModelInstance: PhasePipelineOptions['getModelInstance'];
  modelRoutingConfig: PhasePipelineOptions['modelRoutingConfig'];
  defaultProvider: string;
  defaultModel: string;
  systemPrompt: string;
  messages: Omit<Message, 'id'>[];
  maxTokens?: number;
}

async function runPhase(
  phase: PhaseName,
  previousOutput: string,
  errorContext: string | undefined,
  internals: RunPhaseInternals,
): Promise<string> {
  const { getModelInstance, modelRoutingConfig, defaultProvider, defaultModel, systemPrompt, messages, maxTokens } =
    internals;

  const resolved = resolvePhaseModel(phase, modelRoutingConfig, defaultProvider, defaultModel);
  const prompt = getPhasePrompt(phase, previousOutput, errorContext);

  // Build the augmented system prompt for this phase
  const phaseSystemPrompt = `${systemPrompt}\n\n${prompt.systemSuffix}`;

  // Build the augmented messages: prepend the phase prefix to the last user message
  const augmentedMessages = augmentLastUserMessage(messages, prompt.userPrefix);

  const model = getModelInstance(resolved.provider, resolved.model);

  const streamResult = await _streamText({
    model,
    system: phaseSystemPrompt,
    messages: convertToCoreMessages(augmentedMessages as any),
    ...(maxTokens ? { maxTokens } : {}),
  });

  return consumeStream(streamResult);
}

/**
 * Clones the messages array and prepends `prefix` to the text content of the
 * last user message. Non-destructive — does not mutate the original array.
 */
function augmentLastUserMessage(messages: Omit<Message, 'id'>[], prefix: string): Omit<Message, 'id'>[] {
  const cloned = messages.map((m) => ({ ...m }));

  for (let i = cloned.length - 1; i >= 0; i--) {
    if (cloned[i].role === 'user') {
      const msg = cloned[i];

      if (typeof msg.content === 'string') {
        msg.content = `${prefix}${msg.content}`;
      }

      break;
    }
  }

  return cloned;
}
