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

import { streamText as _streamText, convertToCoreMessages, type Message } from 'ai';
import { createScopedLogger } from '~/utils/logger';
import { resolveModelForOperation, type ModelRoutingConfig } from './model-router';
import { getPhasePrompt, PHASE_NAMES, type PhaseName } from '~/lib/common/prompts/phase-prompts';
import type { OperationType } from './model-router';

const logger = createScopedLogger('PhasePipeline');

/** Maximum number of implement → review correction cycles. */
const MAX_CORRECTION_RETRIES = 2;

/** Special token prefix for phase progress events in the SSE stream. */
const PHASE_EVENT_PREFIX = '__phase:';

/** Sentinel the review phase emits when no errors are found. */
const REVIEW_PASS_SENTINEL = '__review_pass__';

/**
 * Maps each pipeline phase to the model-router operation type so that
 * resolveModelForOperation can pick the best model per phase.
 */
const PHASE_TO_OPERATION: Record<PhaseName, OperationType> = {
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
  const { getModelInstance, modelRoutingConfig, defaultProvider, defaultModel, systemPrompt, messages, maxTokens } =
    options;

  const phaseOutputs: Record<string, string> = {
    plan: '',
    scaffold: '',
    implement: '',
    review: '',
  };

  let previousOutput = '';

  // ── Phase 1: Plan ──────────────────────────────────────────────────────
  logger.info('Starting phase: plan');
  previousOutput = await runPhase('plan', previousOutput, undefined, {
    getModelInstance,
    modelRoutingConfig,
    defaultProvider,
    defaultModel,
    systemPrompt,
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
