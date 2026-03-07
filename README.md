<div align="center">

<img width="236" height="79" alt="devonz" src="https://github.com/user-attachments/assets/30c464d9-39a9-4c0d-85f8-64473cfa774c" />

**AI-powered full-stack development agent :-: describe what you want, watch it build.**

[![Docker Build](https://img.shields.io/github/actions/workflow/status/zebbern/Devonz/ci.yml?branch=main&label=Docker%20Build&logo=docker)](https://github.com/zebbern/Devonz/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/Node-18.18%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

[Features](#features) ━━ [Installation](#installation) ━━ [Configuration](#configuration)

[Docker](#docker) ━━ [Scripts](#scripts) ━━ [Keeping Up to Date](#keeping-up-to-date) 

[Project Structure](#project-structure) ━━ [Contributing](#contributing) ━━ [Acknowledgments](#acknowledgments)

![Devonz Screenshot](https://github.com/user-attachments/assets/e4c3067d-2539-4b5e-abab-d129d90b51dc)

</div>


## Quick Start

**Docker** (recommended):

```bash
docker compose up -d
# Open http://localhost:5173
```

**From source**:

```bash
git clone https://github.com/zebbern/Devonz.git && cd Devonz
pnpm install
pnpm run dev
# Open http://localhost:5173
```

> First load can take up to 2 minutes while dependencies compile.

---

## Why Devonz?

- **22 AI providers** — OpenAI, Anthropic, Google, Groq, Z.ai, Ollama, and more. Swap models mid-conversation.
- **Full dev environment** — editor, terminal, live preview, powered by a local Node.js runtime.
- **One-click deploy** — push to GitHub, GitLab, Netlify, or Vercel directly from the UI.
- **MCP tools** — extend the agent with Model Context Protocol servers for specialized workflows.
- **Auto-fix** — terminal error detection catches failures and patches them automatically.
- **Image context** — attach screenshots or design files to prompts for visual understanding.
- **Design Palette** — pick custom color themes that get injected into AI-generated apps.
- **3D support** — generate React Three Fiber apps with automatic version pinning and peer dependency resolution.
- **Template gallery** — start from popular frameworks and boilerplates, then customize with AI.
- **State-of-the-art AI SDK** — built on the Vercel AI SDK for best-in-class LLM performance and reliability.

---

## Features

**AI & Code Generation**
- Natural language to full-stack apps (Node.js-based)
- 22 LLM providers with hot-swappable model selection
- MCP (Model Context Protocol) tool integration
- Automatic error detection and auto-fix from terminal output
- Attach images to prompts for visual context
- **Extended Thinking** — AI reasoning visualization for Anthropic Claude and Google Gemini
- **MCP Schema Sanitization** — Automatic schema compatibility for Google Gemini (strips unsupported constructs)
- **MCP Auto-Approve** — Per-server auto-approve toggle for trusted MCP servers
- **Formatted Tool Results** — MCP tool results render as formatted markdown instead of raw JSON
- **Design Palette** — UI for picking custom color themes injected into generated code
- **3D App Generation** — React Three Fiber support with automatic version pinning for React 18/19

**Development Environment**
- In-browser code editor (CodeMirror) with syntax highlighting
- Integrated terminal (xterm.js) with full shell access
- Real-time application preview
- Diff view for AI-generated changes
- File locking to prevent conflicts during generation

**Security & Reliability**
- **Security Hardened** — `withSecurity()` on all 42 API routes with input validation, rate limiting options, URL allowlisting

**Deployment & Integrations**
- GitHub / GitLab push and repo management
- Netlify and Vercel one-click deploy
- Supabase database integration
- Git version control built-in
- Template gallery with category filtering, search, live preview, and one-click cloning

---

## Installation

<details>
<summary><strong>From Source (Node.js)</strong></summary>

**Prerequisites**: Node.js 18.18+ and pnpm (latest)

```bash
git clone https://github.com/zebbern/Devonz.git
cd Devonz
pnpm install
pnpm run dev
```

Open [http://localhost:5173](http://localhost:5173).

</details>

<details>
<summary><strong>Docker</strong></summary>

No Node.js required. Just Docker.

```bash
# Option 1: Docker Compose (pulls from GHCR)
docker compose up -d

# Option 2: Build locally
docker build -t devonz .
docker run --rm -p 5173:5173 --env-file .env.local devonz
```

Open [http://localhost:5173](http://localhost:5173).

</details>

---

## Configuration

Copy the example env file and add your API keys:

```bash
cp .env.example .env.local
```

Or use the interactive setup wizard (can init `.env.local`, sync `.env` for Docker, and prompt for keys with hidden input):

```bash
pnpm run setup
```

```bash
# AI Provider API Keys (add any you use)
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key
GOOGLE_GENERATIVE_AI_API_KEY=your_google_key
ZAI_API_KEY=your_zai_key

# Local Provider URLs (optional)
OLLAMA_API_BASE_URL=http://127.0.0.1:11434

# Deployment Tokens (optional — can also be set via UI)
VITE_GITHUB_ACCESS_TOKEN=your_github_token
VITE_NETLIFY_ACCESS_TOKEN=your_netlify_token
```

You can also configure providers in-app: **Settings (gear icon) → Providers tab**.

See [.env.example](.env.example) for all available variables.

---

## Docker

```bash
pnpm docker:build          # Build image locally
pnpm docker:run            # Run standalone container
pnpm docker:up             # Start via Docker Compose
pnpm docker:down           # Stop services
pnpm docker:dev            # Dev mode with hot reload
pnpm docker:update         # Pull latest image + restart
```

**Auto-update with Watchtower** (polls GHCR every 5 minutes):

```bash
docker compose --profile auto-update up -d
```

---

## Scripts

```bash
# Development
pnpm run dev               # Start dev server
pnpm run build             # Production build
pnpm run start             # Run production build
pnpm run preview           # Build + preview locally

# Quality
pnpm test                  # Run test suite
pnpm test:watch            # Tests in watch mode
pnpm run typecheck         # TypeScript type check
pnpm run lint              # ESLint check
pnpm run lint:fix          # Auto-fix lint issues

# Utilities
pnpm run clean             # Clean build artifacts
pnpm run update            # Pull latest + install + rebuild
```

---

## Keeping Up to Date

**Git clone users:**

```bash
pnpm run update                    # pulls, installs deps, rebuilds
pnpm run update -- --skip-build    # pull + install only
```

**Docker users:**

```bash
pnpm docker:update                 # pulls latest image, restarts
```

**Hands-free (Watchtower):**

```bash
docker compose --profile auto-update up -d
```

---

## Project Structure

<details>
<summary>Expand file tree</summary>

```
devonz/
├── app/
│   ├── components/         # React components (10 groups)
│   │   ├── @settings/      # Settings panel (14 tabs)
│   │   ├── chat/           # Chat interface
│   │   ├── deploy/         # Deployment integrations
│   │   ├── editor/         # Code editor (CodeMirror)
│   │   ├── git/            # Git integration
│   │   ├── header/         # App header
│   │   ├── sidebar/        # Sidebar navigation
│   │   ├── templates/      # Template gallery
│   │   ├── ui/             # 40+ shared UI components
│   │   └── workbench/      # Development workbench
│   ├── lib/
│   │   ├── .server/        # Server-only code (LLM streaming)
│   │   ├── agent/          # Agent prompts + orchestration
│   │   ├── common/         # Prompt library + shared prompts
│   │   ├── hooks/          # 25 custom React hooks
│   │   ├── modules/        # Feature modules (22 LLM providers)
│   │   ├── persistence/    # IndexedDB, localStorage, autoBackup
│   │   ├── runtime/        # Action runner, message parser, local runtime
│   │   ├── services/       # API services
│   │   ├── stores/         # 24 nanostores
│   │   └── utils/          # Service-level utilities
│   ├── routes/             # 48 Remix routes (6 pages + 42 API)
│   ├── styles/             # Global styles (SCSS + CSS)
│   └── types/              # TypeScript type definitions
├── docs/                   # Extended documentation
└── scripts/                # Build & update scripts
```

</details>

---

## Tech Stack

**Remix** + **Vite** + **TypeScript** · **UnoCSS** · **Radix UI** · **Framer Motion** · **Vercel AI SDK** · **CodeMirror** · **xterm.js** · **Local Runtime (host Node.js)**

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit changes: `git commit -m 'feat: add my feature'`
4. Push: `git push origin feature/my-feature`
5. Open a Pull Request

See [CONTRIBUTING.md](docs/CONTRIBUTING.md) for detailed guidelines.

---

## Acknowledgments

- [bolt.diy](https://github.com/stackblitz-labs/bolt.diy) — original project foundation
- Originally based on [StackBlitz bolt.new](https://github.com/stackblitz-labs/bolt.diy). Now uses a local Node.js runtime for code execution.
- [Vercel AI SDK](https://sdk.vercel.ai/) — AI capabilities

---

<div align="center">
  <strong>Build anything with AI. Just describe what you want.</strong>
  <br><br>
  <a href="https://github.com/zebbern/Devonz">GitHub</a> ·
  <a href="https://github.com/zebbern/Devonz/issues">Issues</a> ·
  <a href="docs/">Documentation</a>
</div>