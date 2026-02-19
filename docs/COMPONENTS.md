# Components

> Component hierarchy, patterns, and conventions in Devonz.

---

## Overview

All components live in `app/components/`, organized into 9 groups by feature area.

---

## Component Groups

### `chat/` — Chat Interface

The primary user interaction surface. Handles message display, input, file uploads, and LLM streaming.

| Component | Purpose |
| --------- | ------- |
| `Chat.client.tsx` | Top-level chat controller (client-only, wraps AI SDK `useChat`) |
| `BaseChat.tsx` | Layout and props interface for the chat UI |
| `ChatBox.tsx` | Message input area with toolbar |
| `Messages.client.tsx` | Message list renderer |
| `UserMessage.tsx` | User message bubble |
| `AssistantMessage.tsx` | AI response bubble |
| `Artifact.tsx` | Code artifact display with actions |
| `CodeBlock.tsx` | Syntax-highlighted code blocks |
| `Markdown.tsx` | Markdown renderer (react-markdown + rehype) |
| `ExamplePrompts.tsx` | Starter prompt suggestions |
| `StarterTemplates.tsx` | Template gallery for new projects |
| `RecentChats.tsx` | Recent chat history |
| `APIKeyManager.tsx` | API key input/management |
| `CombinedModelSelector.tsx` | Provider + model dropdown selector |
| `FilePreview.tsx` | Uploaded file preview |
| `GitCloneButton.tsx` | Clone from Git URL |
| `ImportFolderButton.tsx` | Import local folder |
| `SendButton.client.tsx` | Send message button |
| `SpeechRecognition.tsx` | Voice input |
| `ThoughtBox.tsx` | AI thinking/reasoning display — renders extended thinking output with expandable/collapsible reasoning content |
| `ToolInvocations.tsx` | Handles agent tool calls AND MCP tool results. Sub-components: `ToolCallsList` (pending calls with auto-approve logic and manual approve/reject buttons), `ToolResultsList` → `ToolResultItem` (tool results with formatted markdown view (default), raw JSON toggle, copy-to-clipboard, collapsible long outputs), `FormattedResultContent` (ReactMarkdown renderer for MCP text results), `extractMcpResultText()` (extracts readable text from MCP protocol results) |
| `ProgressCompilation.tsx` | Build progress indicator |
| `ChatAlert.tsx` | Chat error/warning alerts |
| `LLMApiAlert.tsx` | LLM API error alerts |
| `SupabaseAlert.tsx` | Supabase connection alerts |
| `PlanApprovalAlert.tsx` | Plan approval UI |
| `DicussMode.tsx` | Discuss (non-coding) mode |
| `MCPTools.tsx` | MCP tools indicator in the chat toolbar; MCP tool selection |
| `chatExportAndImport/` | Chat export/import functionality |

### `workbench/` — Code Editor & Preview

The code editing, file management, terminal, and preview environment.

| Component | Purpose |
| --------- | ------- |
| `Workbench.client.tsx` | Main workbench container with panel layout |
| `EditorPanel.tsx` | Code editor panel with CodeMirror |
| `Preview.tsx` | Live preview iframe from WebContainer |
| `FileTree.tsx` | File explorer tree |
| `FileBreadcrumb.tsx` | Breadcrumb navigation for open file |
| `Search.tsx` | File search |
| `terminal/` | Terminal UI components |
| `Plan.tsx` | Plan/task view |
| `Versions.tsx` | Version history/snapshots |
| `StagedChangesPanel.tsx` | Git-like staged changes |
| `DiffPreviewModal.tsx` | Side-by-side diff viewer |
| `Inspector.tsx` | DOM element inspector |
| `InspectorPanel.tsx` | Inspector panel UI |
| `PortDropdown.tsx` | Dev server port selector |
| `AIQuickActions.tsx` | AI-powered quick action buttons |
| `LockManager.tsx` | File lock UI |
| `ExpoQrModal.tsx` | QR code for Expo mobile preview |
| `PageColorPalette.tsx` | Color palette picker |
| `ElementTreeNavigator.tsx` | DOM tree navigation |
| `BoxModelEditor.tsx` | CSS box model editor |
| `BulkStyleSelector.tsx` | Bulk style operations |

### `@settings/` — Settings Panel

Modular settings UI organized by concern.

```text
@settings/
├── core/          # Settings framework (types, constants, layout)
├── tabs/          # Individual settings tabs
│   ├── providers/     # LLM provider configuration
│   ├── features/      # Feature toggles
│   ├── data/          # Data management
│   ├── profile/       # User profile
│   ├── github/        # GitHub settings
│   ├── gitlab/        # GitLab settings
│   ├── netlify/       # Netlify settings
│   ├── vercel/        # Vercel settings
│   ├── supabase/      # Supabase settings
│   ├── mcp/           # MCP server config
│   │   ├── McpServerList.tsx  # Server list with status badges and per-server auto-approve toggle
│   │   └── McpTab.tsx         # MCP configuration tab with server management and auto-approve settings
│   ├── notifications/ # Notification prefs
│   ├── event-logs/    # Event log viewer
│   ├── settings/      # General settings
│   └── project-memory/# Project memory
├── shared/        # Shared settings components
└── utils/         # Settings utilities
```

### `header/` — Application Header

| Component | Purpose |
| --------- | ------- |
| `Header.tsx` | Main header bar |
| `HeaderActionButtons.client.tsx` | Action buttons (deploy, git, etc.) |
| `HeaderAvatar.client.tsx` | User avatar/account |
| `AutoFixStatus.client.tsx` | Auto-fix indicator |

### `sidebar/` — Chat History Sidebar

| Component | Purpose |
| --------- | ------- |
| `Menu.client.tsx` | Sidebar menu with chat history |
| `HistoryItem.tsx` | Individual chat history entry |
| `date-binning.ts` | Groups chats by date (Today, Yesterday, etc.) |

### `ui/` — Reusable UI Primitives

~40 components built on Radix UI primitives. These are the building blocks used everywhere.

| Component | Based On |
| --------- | -------- |
| `Dialog.tsx` | Radix Dialog |
| `Dropdown.tsx` | Radix Dropdown Menu |
| `Popover.tsx` | Radix Popover |
| `Tooltip.tsx` | Radix Tooltip |
| `Tabs.tsx` | Radix Tabs |
| `Switch.tsx` | Radix Switch |
| `Checkbox.tsx` | Radix Checkbox |
| `ScrollArea.tsx` | Radix Scroll Area |
| `Separator.tsx` | Radix Separator |
| `Progress.tsx` | Radix Progress |
| `Button.tsx` | Custom (CVA variants) |
| `IconButton.tsx` | Custom |
| `Input.tsx` | Custom |
| `Label.tsx` | Radix Label |
| `Card.tsx` | Custom |
| `Badge.tsx` | Custom |
| `Slider.tsx` | Custom (code/preview toggle) |
| `ResizeHandle.tsx` | Custom (panel resizer) |
| `FileIcon.tsx` | File type icon mapper |
| `ErrorBoundary.tsx` | React error boundary |
| `LoadingDots.tsx` | Loading animation |
| `LoadingOverlay.tsx` | Full-page loader |
| `EmptyState.tsx` | Empty content placeholder |
| `StatusIndicator.tsx` | Online/offline dot |
| `ThemeSwitch.tsx` | Dark/light toggle |
| `SearchInput.tsx` | Search bar |
| `BranchSelector.tsx` | Git branch picker |
| `Breadcrumbs.tsx` | Path breadcrumbs |
| `Collapsible.tsx` | Radix Collapsible |
| `PanelHeader.tsx` | Panel header bar |
| `PanelHeaderButton.tsx` | Panel header action button |
| `CodeBlock.tsx` | Code display (non-editor) |
| `BackgroundRays/` | Decorative background effect |

### `deploy/` — Deployment Dialogs

| Component | Purpose |
| --------- | ------- |
| `DeployButton.tsx` | Deploy action button |
| `DeployAlert.tsx` | Deployment status/error alerts |
| `GitHubDeploy.client.tsx` | GitHub push dialog |
| `GitHubDeploymentDialog.tsx` | GitHub deployment configuration |
| `GitLabDeploy.client.tsx` | GitLab push dialog |
| `GitLabDeploymentDialog.tsx` | GitLab deployment configuration |
| `VercelDeploy.client.tsx` | Vercel deployment dialog |
| `VercelDomainModal.tsx` | Vercel custom domain setup |
| `NetlifyDeploy.client.tsx` | Netlify deployment dialog |

### `editor/` — CodeMirror Integration

```text
editor/
└── codemirror/    # CodeMirror 6 setup, extensions, themes
```

### `Page Scroll Areas`
w-full h-auto = User text chat scroll
.xterm-viewport = Terminal chat scroll

### `git/` — Git Operations UI

Git-specific UI components for repository management.

---

## Component Conventions

### 1. Client-Only Components

Components that require browser APIs use the `.client.tsx` suffix:

```tsx
// In a route or parent component:
import { ClientOnly } from 'remix-utils/client-only';
import { Chat } from '~/components/chat/Chat.client';

<ClientOnly fallback={<BaseChat />}>
  {() => <Chat />}
</ClientOnly>
```

### 2. Styling

- **UnoCSS utility classes** for layout and spacing
- **CSS Modules** (`.module.scss`) for component-specific styles
- **Inline styles** for guaranteed dark theme colors (see [Styling Guidelines](STYLING-GUIDELINES.md))
- **Radix UI** for accessible primitives with custom styling

### 3. State Access

Components subscribe to stores via `useStore`:

```tsx
import { useStore } from '@nanostores/react';
import { workbenchStore } from '~/lib/stores/workbench';

const showWorkbench = useStore(workbenchStore.showWorkbench);
```

### 4. Icons

Two icon systems:

- **Phosphor Icons**: `@phosphor-icons/react` — general UI icons
- **Custom Icons**: UnoCSS `i-bolt:*` classes — project-specific SVG icons from `icons/` directory
- **UnoCSS Icon Classes**: `i-ph:*` — Phosphor icons via UnoCSS

```tsx
// Phosphor (React component)
import { Gear } from '@phosphor-icons/react';
<Gear size={20} />

// UnoCSS class (div with icon)
<div className="i-ph:gear text-xl" />
<div className="i-bolt:custom-icon text-xl" />
```

### 5. Memoization

Heavy components use `React.memo`:

```tsx
export const Workbench = memo(({ chatStarted, isStreaming }: Props) => {
  // ...
});
```
