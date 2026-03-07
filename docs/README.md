# Devonz Documentation

> AI-powered browser-based coding assistant built with Remix, React, and a local Node.js runtime.

---

## Quick Links

| Document | Description |
|----------|-------------|
| [Getting Started](GETTING-STARTED.md) | Setup, environment variables, run commands |
| [Architecture](ARCHITECTURE.md) | System design, layers, data flow |
| [Components](COMPONENTS.md) | Component hierarchy, patterns, conventions |
| [State Management](STATE-MANAGEMENT.md) | Stores, hooks, data flow patterns |
| [API Routes](API-ROUTES.md) | All server endpoints documented |
| [LLM Providers](LLM-PROVIDERS.md) | Provider system, adding new providers |
| [Agent Mode](AGENT-MODE.md) | Autonomous agent orchestration & tools |
| [Styling Guidelines](STYLING-GUIDELINES.md) | Dark theme, colors, CSS patterns |
| [Deployment](DEPLOYMENT.md) | Vercel, Netlify, GitHub, GitLab integrations |
| [Contributing](CONTRIBUTING.md) | Code style, testing, PR process |

---

## What's New

- **Extended Thinking** — AI reasoning visualization for Anthropic Claude and Google Gemini
- **MCP Schema Sanitization** — Automatic schema compatibility for Google Gemini (strips unsupported constructs)
- **MCP Auto-Approve** — Per-server auto-approve toggle for trusted MCP servers
- **Formatted Tool Results** — MCP tool results render as formatted markdown instead of raw JSON
- **Unified Mode Selector** — Single Build/Plan/Discuss dropdown replaces separate toggles
- **Auto-Collapse Plan** — Plan panel auto-collapses when all tasks reach 100%
- **Security Hardening** — `withSecurity()` on all 42 API routes with input validation, rate limiting options, URL allowlisting
- **810 tests** — Across 36 test files for comprehensive coverage
- **Z.ai Provider** — Integration with 10 static GLM models optimized for coding tasks

---

## Tech Stack at a Glance

| Layer | Technology |
|-------|-----------|
| Framework | Remix v2.16 + React 18 |
| Build | Vite 5.4 |
| Language | TypeScript (strict) |
| Styling | UnoCSS + SCSS + Radix UI |
| State | Nanostores |
| AI/LLM | Vercel AI SDK (22 providers) |
| Editor | CodeMirror 6 |
| Terminal | xterm.js 5.5 |
| Runtime | LocalRuntime (host Node.js) |
| Testing | Vitest + Testing Library |
| Package Manager | pnpm 9.14 |

---

## Project Structure

```
├── app/
│   ├── components/       # React components (10 groups)
│   ├── lib/              # Core logic (stores, services, agent, LLM)
│   ├── routes/           # Remix routes (pages + 42 API routes)
│   ├── styles/           # Global SCSS + CSS
│   ├── types/            # Shared TypeScript types
│   ├── utils/            # Utility functions
│   ├── root.tsx          # App root layout
│   ├── entry.client.tsx  # Client entry
│   └── entry.server.tsx  # Server entry
├── docs/                 # This documentation
├── icons/                # Custom SVG icons (UnoCSS collection)
├── public/               # Static assets
├── scripts/              # Build/clean scripts
└── types/                # Global type declarations
```

---

## Conventions

- **Path alias**: `~/` → `./app/` (enforced by ESLint — no `../` imports)
- **Client-only files**: `.client.tsx` suffix for browser-only components
- **Scoped logging**: `createScopedLogger('Name')` used throughout
- **Validation**: Zod schemas for all API request bodies
- **Theming**: CSS custom properties (`--devonz-elements-*`) + `data-theme` attribute
