# Architecture

> System design, layers, and data flow for Devonz.

---

## High-Level Overview

```text
┌─────────────────────────────────────────────────────────┐
│                     Browser Client                       │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │  Chat UI  │  │  Workbench   │  │    Settings UI    │  │
│  │ Messages  │  │ Editor+Term  │  │  Providers/Keys   │  │
│  └─────┬─────┘  └──────┬───────┘  └────────┬──────────┘  │
│        │               │                   │             │
│  ┌─────▼───────────────▼───────────────────▼──────────┐  │
│  │              Nanostores (State Layer)               │  │
│  │  workbench · chat · files · editor · settings · …  │  │
│  └─────────────────────┬──────────────────────────────┘  │
│                        │                                 │
│  ┌─────────────────────▼──────────────────────────────┐  │
│  │         RuntimeClient (Browser ↔ Server Bridge)     │  │
│  │   Communicates via /api/runtime/* Remix routes       │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
└──────────────────────────┬───────────────────────────────┘
                           │ HTTP (Remix API Routes)
┌──────────────────────────▼───────────────────────────────┐
│                      Remix Server                         │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │  LLM Stream  │  │  MCP Service │  │  Git/Deploy    │  │
│  │  (AI SDK)    │  │  (Tools)     │  │  Proxies       │  │
│  └──────┬───────┘  └──────┬───────┘  └───────┬────────┘  │
│         │                 │                  │           │
│  ┌──────▼─────────────────▼──────────────────▼────────┐  │
│  │          LocalRuntime (Server-Side Execution)       │  │
│  │   File I/O · Shell (Git Bash / system) · Dev server │  │
│  │   Projects at ~/.devonz/projects/{projectId}/       │  │
│  └────────────────────────────────────────────────────┘  │
│         │                 │                  │           │
│  ┌──────▼─────────────────▼──────────────────▼────────┐  │
│  │            External APIs (LLM Providers)            │  │
│  │  OpenAI · Anthropic · Google · Ollama · 18 more     │  │
│  │  (22 total: + Cerebras, Cohere, Deepseek, Fireworks,│  │
│  │   Groq, HuggingFace, Hyperbolic, Mistral, Moonshot, │  │
│  │   OpenRouter, OpenAILike, Perplexity, xAI, Together,│  │
│  │   LMStudio, AmazonBedrock, Github, Z.ai)            │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

---

## Layer Breakdown

### 1. Presentation Layer (`app/components/`)

React components organized into 10 groups. See [Components](COMPONENTS.md) for full details.

**Key pattern**: Components with `.client.tsx` suffix are browser-only (no SSR). Remix's `ClientOnly` wrapper is used in routes to lazy-load them.

### 2. State Layer (`app/lib/stores/`)

24 nanostore files managing all application state. See [State Management](STATE-MANAGEMENT.md) for full details.

**Key pattern**: Class-based stores (`WorkbenchStore`) compose sub-stores (`EditorStore`, `FilesStore`, `TerminalStore`, `PreviewsStore`). HMR-safe via `import.meta.hot.data`.

### 3. Service Layer (`app/lib/services/`)

Business logic separated from UI:

| Service | Purpose |
| ------- | ------- |
| `agentOrchestratorService.ts` | Agent mode execution loop, iteration tracking, approval flows |
| `agentToolsService.ts` | Agent tool definitions and execution |
| `agentChatIntegration.ts` | Bridges agent mode with chat API |
| `mcpService.ts` | MCP (Model Context Protocol) client management — includes schema sanitization for Gemini compatibility (strips `anyOf`, `oneOf`, `allOf`, `additionalProperties`), auto-approve per-server toggle, and formatted markdown rendering of tool results |
| `autoFixService.ts` | Auto-fix error detection and correction |
| `githubApiService.ts` | GitHub API operations |
| `gitlabApiService.ts` | GitLab API operations |
| `importExportService.ts` | Chat import/export functionality |
| `repositoryPushService.ts` | Push project files to remote Git repositories (GitHub/GitLab) |
| `localModelHealthMonitor.ts` | Monitors local model (Ollama/LMStudio) availability |

### 4. LLM Layer (`app/lib/modules/llm/`)

Provider-based architecture for multi-LLM support. See [LLM Providers](LLM-PROVIDERS.md).

**Key pattern**: `LLMManager` singleton auto-discovers and registers all providers from `providers/` directory. Each provider extends `BaseProvider`.

### 5. Runtime Layer (`app/lib/runtime/`)

Handles LLM response parsing and action execution:

| File | Purpose |
| ---- | ------- |
| `message-parser.ts` | Parses LLM streaming output into structured actions (file writes, shell commands) |
| `enhanced-message-parser.ts` | Extended parser that auto-wraps untagged code blocks and shell commands into action tags |
| `action-runner.ts` | Executes parsed actions via LocalRuntime (create files, run commands) |
| `local-runtime.ts` | Server-side runtime managing code execution, file I/O, shell commands, and port detection |
| `local-filesystem.ts` | Local filesystem abstraction for project file operations |
| `runtime-client.ts` | Browser-side client communicating with LocalRuntime via `/api/runtime/*` routes |
| `runtime-provider.ts` | React context provider for runtime initialization and access |
| `git-client.ts` | Git client for repository operations |
| `git-manager.ts` | Git repository lifecycle management |
| `command-safety.ts` | Command validation and safety checks for shell execution |

### 6. Persistence Layer (`app/lib/persistence/`)

| File | Purpose |
| ---- | ------- |
| `db.ts` | IndexedDB schema and connection management |
| `chats.ts` | Chat CRUD operations (getAllChats, getChatById, saveChat, deleteChat) |
| `useChatHistory.ts` | React hook for chat history with IndexedDB, URL sync, duplication |
| `localStorage.ts` | Client-side localStorage utilities with error handling |
| `lockedFiles.ts` | File/folder lock management per chat (localStorage-backed) |
| `snapshotUtils.ts` | Global snapshot utilities for persisting file state |
| `projectPlanMode.ts` | Project plan mode settings per chat (localStorage-backed) |
| `autoBackup.ts` | Automatic backup management for chat data |
| `types.ts` | Shared persistence type definitions |
| `ChatDescription.client.tsx` | Chat description editing component |

### 7. Server Layer (`app/routes/api.*`)

42 Remix API routes. See [API Routes](API-ROUTES.md).

**Key pattern**: Routes use Remix conventions — `action()` for POST/PUT/DELETE, `loader()` for GET. Server-only code lives in `app/lib/.server/`. All 42 route handlers are wrapped with `withSecurity()` from `app/lib/security.ts`, which enforces CORS origin validation, SameSite cookie attributes, request sanitization, and a URL allowlist on the git proxy.

---

## Data Flow: Chat Message

```text
User types message
       │
       ▼
  Chat.client.tsx (sends via AI SDK useChat)
       │
       ▼
  POST /api/chat (Remix action)
       │
       ├── Validate request (Zod schema)
       ├── Load provider settings (cookies)
       ├── Select context (file contents for prompt)
       ├── Build system prompt
       │
       ▼
  streamText() (Vercel AI SDK)
       │
       ├── Stream to LLM provider (OpenAI, Anthropic, etc.)
       ├── Process streaming response
       │     ├── Parse artifacts (file operations)
       │     ├── Parse shell commands
       │     └── Track progress annotations
       │
       ▼
  Client receives stream
       │
       ├── MessageParser processes chunks
       ├── ActionRunner executes file writes via LocalRuntime (server-side)
       ├── ActionRunner executes shell commands via LocalRuntime (server-side)
       └── UI updates (Messages, Editor, Preview)
```

---

## Data Flow: Agent Mode

```text
User enables Agent Mode + sends task
       │
       ▼
  AgentOrchestrator.startSession(task)
       │
       ▼
  ┌─── Iteration Loop ──────────────────┐
  │                                      │
  │  LLM generates tool calls            │
  │       │                              │
  │       ▼                              │
  │  AgentToolsService.execute()         │
  │       │                              │
  │       ├── devonz_read_file           │
  │       ├── devonz_write_file          │
  │       ├── devonz_list_directory      │
  │       ├── devonz_run_command         │
  │       ├── devonz_search_code         │
  │       └── devonz_get_errors          │
  │       │                              │
  │       ▼                              │
  │  Check: needs approval?              │
  │       ├── Yes → wait for user        │
  │       └── No → continue              │
  │       │                              │
  │  Check: max iterations?              │
  │       ├── Yes → warn user            │
  │       └── No → next iteration        │
  │                                      │
  └──────────────────────────────────────┘
       │
       ▼
  AgentOrchestrator.endSession()
```

---

## Key Design Decisions

1. **LocalRuntime for execution**: Code runs on the host machine via `LocalRuntime` (server-side). `RuntimeClient` (browser-side) communicates with it through `/api/runtime/*` Remix routes. `bootRuntime(projectId)` initializes a project runtime with files stored at `~/.devonz/projects/{projectId}/`. Supports native binaries, real Git, and full shell access (Git Bash preferred on Windows). Port detection uses ANSI-stripped regex matching, firing events via SSE to `PreviewsStore` for iframe preview at `http://localhost:PORT`. COEP/COOP headers have been removed (they were WebContainer-only); CSP `frame-src` allows localhost.

2. **Nanostores over Redux/Context**: Lightweight atomic stores avoid the boilerplate of Redux while supporting cross-component reactivity without prop drilling.

3. **Remix for routing + SSR**: Server-side rendering for SEO/initial load, with client-only components for interactive features (editor, terminal, preview).

4. **Provider pattern for LLMs**: Adding a new LLM provider requires only one file — extend `BaseProvider`, define models, implement `getModelInstance()`.

5. **MCP for extensibility**: Model Context Protocol allows connecting external tools (databases, APIs, filesystems) to the AI assistant without modifying core code.

6. **Extended Thinking**: Supported for Anthropic Claude and Google Gemini models. Allows models to expose their internal reasoning process before producing a final answer, with a configurable thinking budget per request.

7. **CSS custom properties for theming**: All theme colors flow through `--devonz-elements-*` variables, enabling runtime theme switching without rebuilds.

8. **Security by default** — Every API route (all 42 handlers) is wrapped with `withSecurity()` from `app/lib/security.ts`, enforcing CORS origin validation, SameSite cookie attributes, request sanitization, and a URL allowlist on the git proxy.

9. **Docker-first deployment** — Multi-stage Dockerfile + docker-compose.yml with GHCR CI/CD and optional Watchtower auto-update enables one-command self-hosting.

10. **Startup performance** — Vite `optimizeDeps` pre-bundles critical dependencies and unconfigured LLM providers are skipped during initialization.

---

## File Naming Conventions

| Pattern | Meaning |
| ------- | ------- |
| `*.client.tsx` | Browser-only component (no SSR) |
| `*.spec.ts` | Test file (Vitest) |
| `*.module.scss` | CSS Modules (scoped styles) |
| `api.*.ts` | Server API route |
| `*.d.ts` | TypeScript declaration file |
