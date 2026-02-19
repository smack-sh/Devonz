# Agent Mode

> Autonomous agent orchestration, tools, and execution flows in Devonz.

---

## Overview

Agent Mode enables Devonz to act as an **autonomous coding agent**. Instead of generating code artifacts in the chat, the LLM uses structured **tool calls** to directly read, write, and execute code in the WebContainer. This enables multi-step, iterative development with error detection and self-correction.

---

## Architecture

```text
┌─────────────────────────────────────────────────┐
│                  Chat Interface                  │
│          (agentMode toggle enabled)              │
└──────────────────────┬──────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────┐
│            agentChatIntegration.ts                │
│  Bridges chat API with agent orchestration        │
└──────────────────────┬───────────────────────────┘
                       │
          ┌────────────▼────────────┐
          │   AgentOrchestrator     │
          │  (agentOrchestratorService.ts)          │
          │                         │
          │  - Session lifecycle    │
          │  - Iteration tracking   │
          │  - Approval workflows   │
          │  - Status management    │
          └────────────┬────────────┘
                       │
          ┌────────────▼────────────┐
          │   AgentToolsService     │
          │  (agentToolsService.ts) │
          │                         │
          │  - Tool definitions     │
          │  - Tool execution       │
          │  - Result formatting    │
          └────────────┬────────────┘
                       │
          ┌────────────▼────────────┐
          │     WebContainer        │
          │  (File I/O, Shell)      │
          └─────────────────────────┘
```

### Key Files

| File | Purpose |
| ---- | ------- |
| `app/lib/agent/index.ts` | Public API — re-exports all agent types and services |
| `app/lib/agent/types.ts` | TypeScript interfaces (454 lines of thorough type definitions) |
| `app/lib/agent/prompts.ts` | System prompts for agent mode (405 lines) |
| `app/lib/services/agentOrchestratorService.ts` | Session management, iteration control, approval flows (321 lines) |
| `app/lib/services/agentToolsService.ts` | Tool definitions and execution logic |
| `app/lib/services/agentChatIntegration.ts` | Integration layer between chat API and agent |
| `app/lib/stores/agentMode.ts` | Nanostore for agent mode UI state |

---

## Agent Tools

The LLM can call these tools during agent mode execution.

> **MCP Tools**: In addition to the built-in `devonz_*` tools listed below, any MCP tools registered through `mcpService` are also available to the LLM during agent mode. MCP tools are registered alongside agent tools and appear in the same tool set passed to the model.

> **Extended Thinking**: Extended thinking is fully compatible with agent mode. When enabled, the model's reasoning steps are shown before each tool call decision.

| Tool | Purpose | Approval Required |
| ---- | ------- | ----------------- |
| `devonz_read_file` | Read file contents (with optional line range) | No |
| `devonz_write_file` | Create or modify files | Configurable |
| `devonz_list_directory` | Explore project structure | No |
| `devonz_run_command` | Execute shell commands (npm, node, etc.) | Configurable |
| `devonz_get_errors` | Check for build/runtime/preview errors | No |
| `devonz_search_code` | Search for code patterns across files | No |

### Tool Parameters

#### `devonz_read_file`

```typescript
{
  path: string;       // File path relative to project root
  startLine?: number; // Optional start line (1-indexed)
  endLine?: number;   // Optional end line (inclusive)
}
```

#### `devonz_write_file`

```typescript
{
  path: string;    // File path relative to project root
  content: string; // Complete file content
}
```

#### `devonz_list_directory`

```typescript
{
  path?: string;     // Directory path (default: "/")
  recursive?: boolean; // List recursively (default: false)
  maxDepth?: number; // Max depth for recursive (default: 3)
}
```

#### `devonz_run_command`

```typescript
{
  command: string;   // Shell command to execute
  cwd?: string;      // Working directory (relative to project root)
  timeout?: number;  // Timeout in ms (default: 30000)
}
```

#### `devonz_get_errors`

```typescript
{
  source?: 'terminal' | 'preview' | 'build' | 'all'; // Error source (default: 'all')
}
```

#### `devonz_search_code`

```typescript
{
  query: string;           // Search pattern (text or regex)
  path?: string;           // Directory to search (default: "/")
  maxResults?: number;     // Max results (default: 50)
  includePattern?: string; // File path include filter
  excludePattern?: string; // File path exclude filter
}
```

---

## Agent Settings

Configurable via the Settings UI or programmatically:

```typescript
interface AgentModeSettings {
  enabled: boolean;                  // Toggle agent mode
  autoApproveFileCreation: boolean;  // Skip approval for new files (default: true)
  autoApproveFileModification: boolean; // Skip approval for file edits (default: true)
  autoApproveCommands: boolean;      // Skip approval for shell commands (default: false)
  maxIterations: number;             // Max iterations per session (default: 25)
}
```

---

## Execution Lifecycle

### Session States

```text
idle → thinking → executing → thinking → ... → completed
                      │
                      ▼
              waiting_for_approval → (approved) → executing
                      │
                      ▼
                  (denied) → thinking
```

| Status | Description |
| ------ | ----------- |
| `idle` | No active session |
| `thinking` | LLM is generating next action |
| `executing` | Tool is being executed |
| `waiting_for_approval` | User approval needed for a tool call |
| `waiting_for_user` | Agent needs user input to continue |
| `error` | An error occurred |
| `completed` | Session finished |

### Session Flow

1. **Start**: `AgentOrchestrator.startSession(task)` — initializes state, sets status to `thinking`
2. **Iterate**: LLM generates tool calls → orchestrator executes them → tracks results
3. **Approval**: If a tool needs approval, status changes to `waiting_for_approval`
4. **Iteration Limit**: If `maxIterations` reached, user is warned
5. **Complete**: `AgentOrchestrator.endSession()` — finalizes state, logs summary

### Session State Tracking

The orchestrator tracks everything during a session:

```typescript
interface AgentExecutionState {
  iteration: number;          // Current iteration count
  maxIterations: number;      // Configured limit
  status: AgentStatus;        // Current status
  isExecuting: boolean;       // Whether actively executing
  toolCalls: ToolCallRecord[]; // All tool calls with results
  totalToolCalls: number;     // Total count
  filesCreated: string[];     // Files created this session
  filesModified: string[];    // Files modified this session
  commandsExecuted: string[]; // Commands run this session
  sessionStartTime: number;   // Start timestamp
  sessionEndTime?: number;    // End timestamp
}
```

---

## System Prompt

When agent mode is active, the standard system prompt is **replaced** with an agent-specific prompt that:

1. Instructs the LLM to use `devonz_*` tools instead of artifact XML tags
2. Defines WebContainer constraints (no native binaries, no git, etc.)
3. Establishes a tool selection hierarchy (prefer `write_file` over shell commands)
4. Forbids outputting file content in plain text (must use tools)

See `app/lib/agent/prompts.ts` for the complete prompt.

---

## Chat Integration

The `agentChatIntegration.ts` module bridges agent mode with the standard chat API:

| Function | Purpose |
| -------- | ------- |
| `shouldUseAgentMode()` | Check if agent mode is enabled for the current request |
| `getAgentToolSetWithoutExecute()` | Get tool definitions (without execute functions) for the AI SDK |
| `getAgentSystemPrompt()` | Get the agent-specific system prompt |
| `initializeAgentSession()` | Start a new agent session |
| `incrementAgentIteration()` | Advance the iteration counter |
| `getAgentIterationWarning()` | Get a warning prompt when nearing iteration limit |
| `processAgentToolInvocations()` | Process tool invocations from LLM response |
| `processAgentToolCall()` | Execute a single tool call |
| `isAgentToolName()` | Check if a tool name is an agent tool |

---

## Error Handling

The agent has built-in error recovery:

1. **Tool execution errors** are captured and returned to the LLM as error results
2. **Build errors** can be detected via `devonz_get_errors` tool
3. **Iteration warnings** prompt the user when approaching the limit
4. **Session errors** set status to `error` with an error message

The LLM is prompted to check for errors after making changes and self-correct when possible.
