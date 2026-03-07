/**
 * Agent Module Index
 *
 * Exports all agent-related types, prompts, and utilities.
 */

// Types
export * from './types';

// Prompts
export { AGENT_MODE_FULL_SYSTEM_PROMPT } from './prompts';

/*
 * Re-export orchestrator and tools from services
 * These are the main entry points for agent mode functionality
 */
export {
  AgentOrchestrator,
  getAgentOrchestrator,
  createAgentOrchestrator,
  resetAgentOrchestrator,
  runAgentTask,
  isAgentModeAvailable,
  getAgentStatus,
} from '~/lib/services/agentOrchestratorService';

export {
  agentToolDefinitions,
  getAgentTools,
  getAgentToolsWithoutExecute,
  executeAgentTool,
  getAgentToolNames,
  isAgentTool,
} from '~/lib/services/agentToolsService';
