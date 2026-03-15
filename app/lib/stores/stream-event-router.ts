import { atom } from 'nanostores';
import { createScopedLogger } from '~/utils/logger';
import { fileGenerationStatus } from './files';
import { structuredStreamingActive, streamingPhase } from './streaming';
import { agentModeStore } from './agentMode';
import { planStore } from './plan';
import type {
  StreamingEvent,
  FileOpenEvent,
  FileChunkEvent,
  FileCloseEvent,
  PhaseChangeEvent,
  ErrorEvent,
  StreamStartEvent,
  DeployStatusEvent,
  PlanPhaseChangedEvent,
  ReviewCycleEvent,
  SubTaskProgressEvent,
  MemoryAccessEvent,
  TokenBudgetUpdateEvent,
  ContextSummaryEvent,
  AgentCheckpointEvent,
  ParallelToolBatchEvent,
} from '~/types/streaming-events';
import type { PlanPhase, AgentCheckpoint, TokenBudgetState } from '~/lib/agent/types';

const logger = createScopedLogger('StreamEventRouter');

interface BufferedFile {
  content: string;
  format: 'full_content' | 'search_replace';
}

/**
 * Internal buffer for file content/diff blocks received via streaming events.
 * Content is accumulated per-file between file_open and file_close events.
 * On file_close, the content is available via getBufferedContent() for
 * the message parser (task-006) to retrieve and apply.
 */
const fileBuffers = new Map<string, BufferedFile>();

/**
 * Retrieve buffered content for a file path.
 * Returns the accumulated content and its format, or null if no buffer exists.
 */
export function getBufferedContent(
  filePath: string,
): { content: string; format: 'full_content' | 'search_replace' } | null {
  const buffer = fileBuffers.get(filePath);

  if (!buffer) {
    return null;
  }

  return { content: buffer.content, format: buffer.format };
}

/**
 * Clear the buffered content for a file path after it has been consumed.
 */
export function clearBufferedContent(filePath: string): void {
  fileBuffers.delete(filePath);
}

function handleStreamStart(_event: StreamStartEvent): void {
  structuredStreamingActive.set(true);
  agentModeStore.setKey('tokenBudget', null);
  agentModeStore.setKey('parallelBatch', null);
  logger.info('Structured streaming started');
}

function handleFileOpen(event: FileOpenEvent): void {
  const { filePath } = event;

  fileGenerationStatus.setKey(filePath, 'generating');

  // Initialize the buffer for this file
  fileBuffers.set(filePath, { content: '', format: 'full_content' });

  logger.debug(`File opened: ${filePath}`);
}

function handleFileChunk(event: FileChunkEvent): void {
  const { filePath, content, format } = event;

  const buffer = fileBuffers.get(filePath);

  if (!buffer) {
    // file_chunk arrived before file_open — create the buffer on the fly
    logger.warn(`Received file_chunk for ${filePath} without preceding file_open, creating buffer`);
    fileBuffers.set(filePath, { content, format });

    return;
  }

  if (buffer.format !== format) {
    /*
     * Format changed mid-stream — this means the file switched from
     * full_content to search_replace or vice versa. Replace the buffer format.
     */
    logger.debug(`File ${filePath} format changed from ${buffer.format} to ${format}`);
    buffer.format = format;
  }

  buffer.content += content;
}

function handleFileClose(event: FileCloseEvent): void {
  const { filePath } = event;

  fileGenerationStatus.setKey(filePath, 'complete');

  logger.debug(`File closed: ${filePath}`);
}

function handlePhaseChange(event: PhaseChangeEvent): void {
  streamingPhase.set(event.phase);
  logger.info(`Phase changed to: ${event.phase}${event.description ? ` — ${event.description}` : ''}`);
}

function handleError(event: ErrorEvent): void {
  const { code, message, recoverable } = event;

  logger.error(`Stream error [${code}]: ${message} (recoverable: ${recoverable})`);

  // If there are any files currently generating, mark them as errored
  const currentStatuses = fileGenerationStatus.get();

  for (const [filePath, status] of Object.entries(currentStatuses)) {
    if (status === 'generating') {
      fileGenerationStatus.setKey(filePath, 'error');
    }
  }
}

function handleDeployStatus(event: DeployStatusEvent): void {
  /*
   * Deployment store wiring will be done in task-008.
   * Log for now so the event is acknowledged but not lost.
   */
  logger.debug(`Deploy status: ${event.state}${event.url ? ` url=${event.url}` : ''}`);
}

/**
 * Latest plan phase transition received from the server.
 * ProgressCompilation.tsx subscribes to this to render phase badges.
 */
export const latestPlanPhaseChange = atom<PlanPhaseChangedEvent | null>(null);

/**
 * Latest review cycle event received from the server.
 * ProgressCompilation.tsx subscribes to this to render review cycle indicators.
 */
export const latestReviewCycle = atom<ReviewCycleEvent | null>(null);

function handlePlanPhaseChanged(event: PlanPhaseChangedEvent): void {
  agentModeStore.setKey('planPhase', event.toPhase as PlanPhase);
  latestPlanPhaseChange.set(event);
  logger.info(
    `Plan phase changed: ${event.fromPhase} → ${event.toPhase}${event.taskId ? ` (task: ${event.taskId})` : ''}`,
  );
}

function handleReviewCycle(event: ReviewCycleEvent): void {
  latestReviewCycle.set(event);
  logger.info(
    `Review cycle #${event.cycleNumber} (triggered by: ${event.triggeredBy}, errors: ${event.errorsFound.length}, fix attempted: ${event.fixAttempted})`,
  );
}

function handleSubTaskProgress(event: SubTaskProgressEvent): void {
  const { parentTaskId, subTaskId, status } = event;
  const currentState = planStore.get();
  const taskIndex = currentState.tasks.findIndex((t) => t.id === parentTaskId);

  if (taskIndex === -1) {
    logger.warn(`Parent task ${parentTaskId} not found in plan store for sub-task ${subTaskId}`);
    return;
  }

  const task = currentState.tasks[taskIndex];
  const subTasks = task.subTasks;

  if (!subTasks || subTasks.length === 0) {
    logger.warn(`Task ${parentTaskId} has no sub-tasks, cannot update sub-task ${subTaskId}`);
    return;
  }

  const subTaskIndex = subTasks.findIndex((s) => s.id === subTaskId);

  if (subTaskIndex === -1) {
    logger.warn(`Sub-task ${subTaskId} not found in task ${parentTaskId}`);
    return;
  }

  const updatedSubTasks = [...subTasks];
  updatedSubTasks[subTaskIndex] = { ...updatedSubTasks[subTaskIndex], status };

  const updatedTasks = [...currentState.tasks];
  updatedTasks[taskIndex] = { ...updatedTasks[taskIndex], subTasks: updatedSubTasks };

  planStore.set({ ...currentState, tasks: updatedTasks });
  logger.debug(`Sub-task ${subTaskId} of ${parentTaskId} updated to ${status} (${event.progress}%)`);
}

function handleMemoryAccess(event: MemoryAccessEvent): void {
  logger.debug(`Memory ${event.action}: [${event.category}] ${event.key}${event.summary ? ` — ${event.summary}` : ''}`);
}

function handleTokenBudgetUpdate(event: TokenBudgetUpdateEvent): void {
  const avgTokensPerStep = event.stepNumber > 0 ? event.totalTokens / event.stepNumber : 0;
  const remainingTokens = Math.max(0, event.maxContextTokens - event.totalTokens);
  const stepsRemaining = avgTokensPerStep > 0 ? Math.floor(remainingTokens / avgTokensPerStep) : 0;

  agentModeStore.setKey('tokenBudget', {
    promptTokens: event.promptTokens,
    completionTokens: event.completionTokens,
    totalTokens: event.totalTokens,
    maxContextTokens: event.maxContextTokens,
    usagePercentage: event.usagePercentage,
    stepsRemaining,
  });
  logger.debug(
    `Token budget updated: ${event.totalTokens}/${event.maxContextTokens} (${event.usagePercentage}%) step=${event.stepNumber}, ~${stepsRemaining} steps remaining`,
  );
}

let parallelBatchClearTimer: ReturnType<typeof setTimeout> | null = null;

function handleParallelToolBatch(event: ParallelToolBatchEvent): void {
  const { batchId, tools, status, results } = event;

  if (parallelBatchClearTimer !== null) {
    clearTimeout(parallelBatchClearTimer);
    parallelBatchClearTimer = null;
  }

  const completedCount = results?.length ?? 0;

  if (status === 'running' || status === 'pending') {
    agentModeStore.setKey('parallelBatch', {
      batchId,
      toolCount: tools.length,
      status,
      completedCount,
    });
    logger.debug(`Parallel tool batch ${batchId}: ${status} (${tools.length} tools)`);
  } else if (status === 'completed' || status === 'failed') {
    agentModeStore.setKey('parallelBatch', {
      batchId,
      toolCount: tools.length,
      status,
      completedCount,
    });
    logger.info(`Parallel tool batch ${batchId}: ${status} (${completedCount}/${tools.length} tools completed)`);

    parallelBatchClearTimer = setTimeout(() => {
      agentModeStore.setKey('parallelBatch', null);
      parallelBatchClearTimer = null;
    }, 2000);
  }
}

function handleContextSummary(event: ContextSummaryEvent): void {
  const tokensSaved = event.originalTokenCount - event.summarizedTokenCount;
  const reductionPct = event.originalTokenCount > 0 ? ((tokensSaved / event.originalTokenCount) * 100).toFixed(1) : '0';

  logger.info(
    `Context summarized: ${event.originalTokenCount} → ${event.summarizedTokenCount} tokens ` +
      `(${reductionPct}% reduction), ${event.messagesRemoved} messages removed`,
  );
  logger.debug(`Summary excerpt: ${event.summaryExcerpt}`);
}

function handleAgentCheckpoint(event: AgentCheckpointEvent): void {
  logger.info(`Agent checkpoint ${event.action}: ${event.checkpointId} (phase: ${event.phase}, chat: ${event.chatId})`);

  if (event.action === 'saved') {
    // Fire-and-forget: persist checkpoint to IndexedDB using client-side state
    persistCheckpointFromEvent(event).catch((err) => {
      logger.error('Failed to persist agent checkpoint to IndexedDB:', err);
    });
  }
}

/**
 * Build and save an AgentCheckpoint to IndexedDB from the client-side stores.
 * The server triggers the save via the agent_checkpoint event; this function
 * assembles the checkpoint data from client-side state and persists it.
 */
async function persistCheckpointFromEvent(event: AgentCheckpointEvent): Promise<void> {
  const { openDatabase, saveAgentCheckpoint, getMessages } = await import('~/lib/persistence/db');
  const { chatId: chatIdAtom } = await import('~/lib/persistence/useChatHistory');

  const database = await openDatabase();

  if (!database) {
    logger.warn('Cannot persist checkpoint: IndexedDB not available');
    return;
  }

  const resolvedChatId = chatIdAtom.get() || event.chatId;

  // Read current messages from IndexedDB for accurate serialization
  let serializedMessages = '[]';

  try {
    const chatData = await getMessages(database, resolvedChatId);

    if (chatData?.messages) {
      serializedMessages = JSON.stringify(chatData.messages);
    }
  } catch {
    logger.warn('Could not read messages for checkpoint — using empty array');
  }

  // Build token budget from the client-side agent mode store
  const budgetSnapshot = agentModeStore.get().tokenBudget;
  const tokenBudget: TokenBudgetState = budgetSnapshot ?? {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    maxContextTokens: 0,
    usagePercentage: 0,
    stepsRemaining: 0,
  };

  // Build a minimal agent state snapshot from client-side stores
  const agentState = JSON.stringify({
    planPhase: agentModeStore.get().planPhase,
    status: agentModeStore.get().status,
    iteration: agentModeStore.get().iteration,
  });

  const checkpoint: AgentCheckpoint = {
    id: event.checkpointId,
    chatId: resolvedChatId,
    phase: event.phase as PlanPhase,
    timestamp: event.timestamp,
    messages: serializedMessages,
    agentState,
    tokenBudget,
  };

  await saveAgentCheckpoint(database, checkpoint);
  logger.info(`Checkpoint ${event.checkpointId} saved to IndexedDB for chat ${resolvedChatId}`);
}

/**
 * Dispatch a validated StreamingEvent to the appropriate store handler.
 *
 * This is the single entry point for all structured streaming events
 * received from the server's data channel.
 */
export function processStreamEvent(event: StreamingEvent): void {
  switch (event.type) {
    case 'stream_start':
      handleStreamStart(event);
      break;
    case 'file_open':
      handleFileOpen(event);
      break;
    case 'file_chunk':
      handleFileChunk(event);
      break;
    case 'file_close':
      handleFileClose(event);
      break;
    case 'action_start':
      // Action handling will be wired via the message parser in task-006
      logger.debug(`Action started: ${event.actionId} — ${event.description}`);
      break;
    case 'action_end':
      // Action handling will be wired via the message parser in task-006
      logger.debug(`Action ended: ${event.actionId} (success: ${event.success})`);
      break;
    case 'phase_change':
      handlePhaseChange(event);
      break;
    case 'deploy_status':
      handleDeployStatus(event);
      break;
    case 'error':
      handleError(event);
      break;
    case 'error_validation':
      logger.debug(
        `Error validation: [${event.category}] fingerprint=${event.fingerprint}, loop=${event.loopDetected}`,
      );
      break;
    case 'plan_phase_changed':
      handlePlanPhaseChanged(event);
      break;
    case 'review_cycle':
      handleReviewCycle(event);
      break;
    case 'sub_task_progress':
      handleSubTaskProgress(event);
      break;
    case 'memory_access':
      handleMemoryAccess(event);
      break;
    case 'token_budget_update':
      handleTokenBudgetUpdate(event);
      break;
    case 'context_summary':
      handleContextSummary(event);
      break;
    case 'agent_checkpoint':
      handleAgentCheckpoint(event);
      break;
    case 'parallel_tool_batch':
      handleParallelToolBatch(event);
      break;
    default: {
      // Exhaustiveness check — TypeScript will error if a case is missing
      const _exhaustive: never = event;
      logger.warn('Unhandled event type:', (_exhaustive as StreamingEvent).type);
    }
  }
}
