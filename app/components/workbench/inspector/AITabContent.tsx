/**
 * AI tab content for the Inspector panel.
 *
 * Renders the quick actions grid for AI-powered element modifications.
 * Extracted from InspectorPanel for better maintainability.
 *
 * @module workbench/inspector/AITabContent
 */

import { memo } from 'react';
import type { ElementInfo } from '~/lib/inspector/types';
import { AiQuickActions } from '~/components/workbench/AIQuickActions';

/* ─── Props ────────────────────────────────────────────────────────── */

export interface AiTabContentProps {
  selectedElement: ElementInfo;
  onQuickAction: (action: string) => void;
}

/* ─── Component ───────────────────────────────────────────────────── */

export const AiTabContent = memo(({ selectedElement, onQuickAction }: AiTabContentProps) => {
  return (
    <div className="p-3">
      <AiQuickActions selectedElement={selectedElement} onAIAction={onQuickAction} />
    </div>
  );
});

AiTabContent.displayName = 'AiTabContent';
