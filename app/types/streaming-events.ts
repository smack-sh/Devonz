/**
 * Streaming Event Protocol — Shared Contract
 *
 * Defines all typed streaming events that flow from server to client
 * via dataStream.writeData(). This is the contract between server-side
 * LLM output parsing and client-side state management.
 *
 * Transport: Vercel AI SDK createDataStream + mergeIntoDataStream (SSE).
 * Validation: Zod schemas for runtime validation on the client side.
 *
 * @module types/streaming-events
 */

import { z } from 'zod';

export const STREAMING_PROTOCOL_VERSION = 'structured-v1' as const;

/* Base fields shared by every streaming event */
const baseEventSchema = z.object({
  timestamp: z.string().datetime(),

  artifactId: z.string().optional(),
});

/** Handshake event — first event sent when a stream begins */
export const streamStartEventSchema = baseEventSchema.extend({
  type: z.literal('stream_start'),

  protocol: z.literal(STREAMING_PROTOCOL_VERSION),

  capabilities: z.array(z.string()),
});

/** Signals the start of a file being streamed */
export const fileOpenEventSchema = baseEventSchema.extend({
  type: z.literal('file_open'),

  filePath: z.string(),
});

/** Chunk of file content (full replacement or search-replace diff) */
export const fileChunkEventSchema = baseEventSchema.extend({
  type: z.literal('file_chunk'),

  filePath: z.string(),

  format: z.enum(['full_content', 'search_replace']),

  content: z.string(),
});

/** Signals file streaming is complete */
export const fileCloseEventSchema = baseEventSchema.extend({
  type: z.literal('file_close'),

  filePath: z.string(),
});

/** Signals the start of a named action (shell, deploy, etc.) */
export const actionStartEventSchema = baseEventSchema.extend({
  type: z.literal('action_start'),

  actionId: z.string(),

  description: z.string(),
});

/** Signals an action has completed */
export const actionEndEventSchema = baseEventSchema.extend({
  type: z.literal('action_end'),

  actionId: z.string(),

  success: z.boolean(),

  error: z.string().optional(),
});

/** Signals a change in the high-level processing phase */
export const phaseChangeEventSchema = baseEventSchema.extend({
  type: z.literal('phase_change'),

  phase: z.string(),

  description: z.string().optional(),
});

/** Deployment status updates (Vercel / Netlify / etc.) */
export const deployStatusEventSchema = baseEventSchema.extend({
  type: z.literal('deploy_status'),

  state: z.enum(['uploading', 'building', 'ready', 'error']),

  url: z.string().optional(),

  errorMessage: z.string().optional(),

  provider: z.string().optional(),
});

/** Error event — carries structured error information */
export const errorEventSchema = baseEventSchema.extend({
  type: z.literal('error'),

  code: z.string(),

  message: z.string(),

  recoverable: z.boolean(),
});

/** Error validation event — server-side error analysis results */
export const errorValidationEventSchema = baseEventSchema.extend({
  type: z.literal('error_validation'),

  /** Error category classification */
  category: z.enum(['import-resolution', 'syntax', 'type', 'runtime', 'build', 'unknown']),

  /** Stable hash fingerprint for this error (FNV-1a of type+message) */
  fingerprint: z.string(),

  /** Targeted fix suggestion from server-side analysis */
  suggestion: z.string(),

  /** Whether a fix loop has been detected for this error fingerprint */
  loopDetected: z.boolean(),
});

/** Agent plan phase transition event */
export const planPhaseChangedEventSchema = baseEventSchema.extend({
  type: z.literal('plan_phase_changed'),

  /** Phase the agent is transitioning from */
  fromPhase: z.enum(['idle', 'planning', 'executing', 'reviewing']),

  /** Phase the agent is transitioning to */
  toPhase: z.enum(['idle', 'planning', 'executing', 'reviewing']),

  /** Optional task ID associated with the phase change */
  taskId: z.string().optional(),
});

/** Self-review cycle event for run→detect→fix loops */
export const reviewCycleEventSchema = baseEventSchema.extend({
  type: z.literal('review_cycle'),

  /** Sequential cycle number within the current session (1-based) */
  cycleNumber: z.number().int().min(1),

  /** What triggered this review cycle */
  triggeredBy: z.enum(['auto', 'user', 'error-detection']),

  /** Errors discovered during this review cycle */
  errorsFound: z.array(z.string()),

  /** Whether a fix was attempted in response to the errors */
  fixAttempted: z.boolean(),

  /** Stable fingerprint for deduplication across cycles */
  fingerprint: z.string(),
});

/** Sub-task progress event for granular task tracking */
export const subTaskProgressEventSchema = baseEventSchema.extend({
  type: z.literal('sub_task_progress'),

  /** ID of the parent task that owns this sub-task */
  parentTaskId: z.string(),

  /** ID of the sub-task being updated */
  subTaskId: z.string(),

  /** Current status of the sub-task */
  status: z.enum(['pending', 'in-progress', 'done', 'failed']),

  /** Completion progress percentage (0–100) */
  progress: z.number().min(0).max(100),
});

/** Memory access event for cross-session context tracking */
export const memoryAccessEventSchema = baseEventSchema.extend({
  type: z.literal('memory_access'),

  /** Type of memory operation */
  action: z.enum(['read', 'write', 'delete']),

  /** Category grouping for the memory entry */
  category: z.string(),

  /** Key identifying the memory entry */
  key: z.string(),

  /** Optional human-readable summary of the operation */
  summary: z.string().optional(),
});

/** Token budget usage snapshot after each agent step */
export const tokenBudgetUpdateEventSchema = baseEventSchema.extend({
  type: z.literal('token_budget_update'),

  /** Prompt (input) tokens consumed so far */
  promptTokens: z.number().int().min(0),

  /** Completion (output) tokens consumed so far */
  completionTokens: z.number().int().min(0),

  /** Total tokens consumed (prompt + completion) */
  totalTokens: z.number().int().min(0),

  /** Maximum context window size in tokens */
  maxContextTokens: z.number().int().min(0),

  /** Percentage of context window used (0–100, or -1 when provider usage data is unavailable) */
  usagePercentage: z.union([z.literal(-1), z.number().min(0).max(100)]),

  /** Sequential step number within the current session (1-based) */
  stepNumber: z.number().int().min(1),
});

/** Notification that messages were summarized to reclaim context space */
export const contextSummaryEventSchema = baseEventSchema.extend({
  type: z.literal('context_summary'),

  /** Token count before summarization */
  originalTokenCount: z.number().int().min(0),

  /** Token count after summarization */
  summarizedTokenCount: z.number().int().min(0),

  /** Number of messages removed during summarization */
  messagesRemoved: z.number().int().min(0),

  /** Short excerpt of the generated summary */
  summaryExcerpt: z.string(),
});

/** Notification that an agent checkpoint was saved or restored */
export const agentCheckpointEventSchema = baseEventSchema.extend({
  type: z.literal('agent_checkpoint'),

  /** Unique identifier for this checkpoint */
  checkpointId: z.string(),

  /** Agent phase at the time of the checkpoint */
  phase: z.string(),

  /** Chat session this checkpoint belongs to */
  chatId: z.string(),

  /** Whether the checkpoint was saved or restored */
  action: z.enum(['saved', 'restored']),
});

/** Batch of read-only tool calls executed in parallel */
export const parallelToolBatchEventSchema = baseEventSchema.extend({
  type: z.literal('parallel_tool_batch'),

  /** Unique identifier for this batch */
  batchId: z.string(),

  /** Tools in the batch with their parameters */
  tools: z.array(
    z.object({
      name: z.string(),
      params: z.record(z.string(), z.any()),
    }),
  ),

  /** Current status of the batch */
  status: z.enum(['pending', 'running', 'completed', 'failed']),

  /** Results from completed tool calls (present when status is 'completed') */
  results: z
    .array(
      z.object({
        name: z.string(),
        output: z.any(),
      }),
    )
    .optional(),
});

/** Zod schema for the full discriminated union of all streaming events */
export const streamingEventSchema = z.discriminatedUnion('type', [
  streamStartEventSchema,
  fileOpenEventSchema,
  fileChunkEventSchema,
  fileCloseEventSchema,
  actionStartEventSchema,
  actionEndEventSchema,
  phaseChangeEventSchema,
  deployStatusEventSchema,
  errorEventSchema,
  errorValidationEventSchema,
  planPhaseChangedEventSchema,
  reviewCycleEventSchema,
  subTaskProgressEventSchema,
  memoryAccessEventSchema,
  tokenBudgetUpdateEventSchema,
  contextSummaryEventSchema,
  agentCheckpointEventSchema,
  parallelToolBatchEventSchema,
]);

export type StreamStartEvent = z.infer<typeof streamStartEventSchema>;
export type FileOpenEvent = z.infer<typeof fileOpenEventSchema>;
export type FileChunkEvent = z.infer<typeof fileChunkEventSchema>;
export type FileCloseEvent = z.infer<typeof fileCloseEventSchema>;
export type ActionStartEvent = z.infer<typeof actionStartEventSchema>;
export type ActionEndEvent = z.infer<typeof actionEndEventSchema>;
export type PhaseChangeEvent = z.infer<typeof phaseChangeEventSchema>;
export type DeployStatusEvent = z.infer<typeof deployStatusEventSchema>;
export type ErrorEvent = z.infer<typeof errorEventSchema>;
export type ErrorValidationEvent = z.infer<typeof errorValidationEventSchema>;
export type PlanPhaseChangedEvent = z.infer<typeof planPhaseChangedEventSchema>;
export type ReviewCycleEvent = z.infer<typeof reviewCycleEventSchema>;
export type SubTaskProgressEvent = z.infer<typeof subTaskProgressEventSchema>;
export type MemoryAccessEvent = z.infer<typeof memoryAccessEventSchema>;
export type TokenBudgetUpdateEvent = z.infer<typeof tokenBudgetUpdateEventSchema>;
export type ContextSummaryEvent = z.infer<typeof contextSummaryEventSchema>;
export type AgentCheckpointEvent = z.infer<typeof agentCheckpointEventSchema>;
export type ParallelToolBatchEvent = z.infer<typeof parallelToolBatchEventSchema>;

/** Discriminated union of all streaming events */
export type StreamingEvent = z.infer<typeof streamingEventSchema>;

/** All valid event type discriminators */
export type StreamingEventType = StreamingEvent['type'];
