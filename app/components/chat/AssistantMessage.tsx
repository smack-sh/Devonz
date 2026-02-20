import { memo, Fragment, useState } from 'react';
import { Markdown } from './Markdown';
import type { JSONValue } from 'ai';
import Popover from '~/components/ui/Popover';
import { workbenchStore } from '~/lib/stores/workbench';
import { WORK_DIR } from '~/utils/constants';
import WithTooltip from '~/components/ui/Tooltip';
import type { Message } from 'ai';
import type { ProviderInfo } from '~/types/model';
import type {
  TextUIPart,
  ReasoningUIPart,
  ToolInvocationUIPart,
  SourceUIPart,
  FileUIPart,
  StepStartUIPart,
} from '@ai-sdk/ui-utils';
import { ToolInvocations } from './ToolInvocations';
import type { ToolCallAnnotation } from '~/types/context';

/**
 * Collapsible block that displays AI reasoning / thinking content.
 * Renders as a styled <details> element with a brain icon header.
 */
const ThinkingBlock = memo(({ reasoningParts }: { reasoningParts: ReasoningUIPart[] }) => {
  const [isOpen, setIsOpen] = useState(false);
  const combinedText = reasoningParts.map((p) => p.reasoning).join('\n');

  if (!combinedText.trim()) {
    return null;
  }

  return (
    <div className="mb-3 rounded-lg border border-devonz-elements-borderColor overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-devonz-elements-textSecondary bg-devonz-elements-background-depth-2 hover:bg-devonz-elements-background-depth-3 transition-colors"
      >
        <div className="i-ph:brain w-4 h-4 text-purple-400" />
        <span>Thinking</span>
        <div
          className={`i-ph:caret-right w-3 h-3 ml-auto transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}
        />
      </button>
      {isOpen && (
        <div className="px-3 py-2 text-xs text-devonz-elements-textSecondary bg-devonz-elements-background-depth-1 border-t border-devonz-elements-borderColor max-h-64 overflow-y-auto whitespace-pre-wrap leading-relaxed">
          {combinedText}
        </div>
      )}
    </div>
  );
});

interface AssistantMessageProps {
  content: string;
  annotations?: JSONValue[];
  messageId?: string;
  onRewind?: (messageId: string) => void;
  onFork?: (messageId: string) => void;
  append?: (message: Message) => void;
  chatMode?: 'discuss' | 'build';
  setChatMode?: (mode: 'discuss' | 'build') => void;
  model?: string;
  provider?: ProviderInfo;
  parts:
    | (TextUIPart | ReasoningUIPart | ToolInvocationUIPart | SourceUIPart | FileUIPart | StepStartUIPart)[]
    | undefined;
  addToolResult: ({ toolCallId, result }: { toolCallId: string; result: unknown }) => void;
}

function openArtifactInWorkbench(filePath: string) {
  filePath = normalizedFilePath(filePath);

  if (workbenchStore.currentView.get() !== 'code') {
    workbenchStore.currentView.set('code');
  }

  workbenchStore.setSelectedFile(`${WORK_DIR}/${filePath}`);
}

function normalizedFilePath(path: string) {
  let normalizedPath = path;

  if (normalizedPath.startsWith(WORK_DIR)) {
    normalizedPath = path.replace(WORK_DIR, '');
  }

  if (normalizedPath.startsWith('/')) {
    normalizedPath = normalizedPath.slice(1);
  }

  return normalizedPath;
}

export const AssistantMessage = memo(
  ({
    content,
    annotations,
    messageId,
    onRewind,
    onFork,
    append,
    chatMode,
    setChatMode,
    model,
    provider,
    parts,
    addToolResult,
  }: AssistantMessageProps) => {
    const filteredAnnotations = (annotations?.filter(
      (annotation: JSONValue) =>
        annotation && typeof annotation === 'object' && Object.keys(annotation).includes('type'),
    ) || []) as Array<{ type: string; value?: unknown; summary?: string; files?: string[]; [key: string]: unknown }>;

    let chatSummary: string | undefined = undefined;

    if (filteredAnnotations.find((annotation) => annotation.type === 'chatSummary')) {
      chatSummary = filteredAnnotations.find((annotation) => annotation.type === 'chatSummary')?.summary;
    }

    let codeContext: string[] | undefined = undefined;

    if (filteredAnnotations.find((annotation) => annotation.type === 'codeContext')) {
      codeContext = filteredAnnotations.find((annotation) => annotation.type === 'codeContext')?.files;
    }

    const usage = filteredAnnotations.find((annotation) => annotation.type === 'usage')?.value as
      | { completionTokens: number; promptTokens: number; totalTokens: number }
      | undefined;

    const toolInvocations = parts?.filter((part) => part.type === 'tool-invocation');
    const reasoningParts = parts?.filter((part) => part.type === 'reasoning') as ReasoningUIPart[] | undefined;
    const toolCallAnnotations = filteredAnnotations.filter(
      (annotation) => annotation.type === 'toolCall',
    ) as ToolCallAnnotation[];

    return (
      <div className="overflow-hidden w-full">
        {/* Assistant Header - Blink style */}
        <div className="flex items-center gap-2 mb-3">
          <div className="w-6 h-6 rounded-full bg-devonz-elements-bg-depth-3 border border-devonz-elements-borderColor flex items-center justify-center">
            <span className="text-xs font-bold text-devonz-elements-textPrimary">D</span>
          </div>
          <span className="text-sm font-medium text-devonz-elements-textSecondary">Devonz</span>
          {(codeContext || chatSummary) && (
            <Popover
              side="right"
              align="start"
              trigger={
                <div className="i-ph:info text-devonz-elements-textTertiary hover:text-devonz-elements-textSecondary transition-colors cursor-pointer" />
              }
            >
              {chatSummary && (
                <div className="max-w-chat">
                  <div className="summary max-h-96 flex flex-col">
                    <h2 className="border border-devonz-elements-borderColor rounded-md p4">Summary</h2>
                    <div style={{ zoom: 0.7 }} className="overflow-y-auto m4">
                      <Markdown>{chatSummary}</Markdown>
                    </div>
                  </div>
                  {codeContext && (
                    <div className="code-context flex flex-col p4 border border-devonz-elements-borderColor rounded-md">
                      <h2>Context</h2>
                      <div className="flex gap-4 mt-4 devonz" style={{ zoom: 0.6 }}>
                        {codeContext.map((x) => {
                          const normalized = normalizedFilePath(x);
                          return (
                            <Fragment key={normalized}>
                              <code
                                className="bg-devonz-elements-artifacts-inlineCode-background text-devonz-elements-artifacts-inlineCode-text px-1.5 py-1 rounded-md text-devonz-elements-item-contentAccent hover:underline cursor-pointer"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  openArtifactInWorkbench(normalized);
                                }}
                              >
                                {normalized}
                              </code>
                            </Fragment>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div className="context"></div>
            </Popover>
          )}
          <div className="flex-1" />
          {usage && (
            <div className="text-xs text-devonz-elements-textTertiary">{usage.totalTokens.toLocaleString()} tokens</div>
          )}
          {(onRewind || onFork) && messageId && (
            <div className="flex gap-1.5">
              {onRewind && (
                <WithTooltip tooltip="Revert to this message">
                  <button
                    onClick={() => onRewind(messageId)}
                    key="i-ph:arrow-u-up-left"
                    aria-label="Revert to this message"
                    className="i-ph:arrow-u-up-left text-lg text-devonz-elements-textTertiary hover:text-devonz-elements-textPrimary transition-colors"
                  />
                </WithTooltip>
              )}
              {onFork && (
                <WithTooltip tooltip="Fork chat from this message">
                  <button
                    onClick={() => onFork(messageId)}
                    key="i-ph:git-fork"
                    className="i-ph:git-fork text-lg text-devonz-elements-textTertiary hover:text-devonz-elements-textPrimary transition-colors"
                  />
                </WithTooltip>
              )}
            </div>
          )}
        </div>

        {/* Reasoning / Thinking Display */}
        {reasoningParts && reasoningParts.length > 0 && <ThinkingBlock reasoningParts={reasoningParts} />}

        {/* Message Content */}
        <div className="text-devonz-elements-textPrimary text-sm leading-relaxed">
          <Markdown
            append={append}
            chatMode={chatMode}
            setChatMode={setChatMode}
            model={model}
            provider={provider}
            html
          >
            {content}
          </Markdown>
        </div>

        {toolInvocations && toolInvocations.length > 0 && (
          <div className="mt-3">
            <ToolInvocations
              toolInvocations={toolInvocations}
              toolCallAnnotations={toolCallAnnotations}
              addToolResult={addToolResult}
            />
          </div>
        )}
      </div>
    );
  },
);
