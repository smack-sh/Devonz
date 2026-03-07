/**
 * Re-exports from the canonical inspector type definitions.
 *
 * All inspector types now live in `~/lib/inspector/types`. This file
 * exists for backward compatibility with existing imports throughout the
 * codebase (Chat, Workbench, AIQuickActions, etc.).
 *
 * @module workbench/inspector-types
 */
export type { ElementInfo } from '~/lib/inspector/types';
