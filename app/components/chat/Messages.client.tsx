import type { Message } from 'ai';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { atom } from 'nanostores';
import { useStore } from '@nanostores/react';
import { classNames } from '~/utils/classNames';
import { AssistantMessage } from './AssistantMessage';
import { UserMessage } from './UserMessage';
import { useLocation, useNavigate } from 'react-router';
import { db, chatId } from '~/lib/persistence/useChatHistory';
import { forkChat, getBranchesByParentChatId } from '~/lib/persistence/db';
import { toast } from 'react-toastify';
import { forwardRef } from 'react';
import type { ForwardedRef } from 'react';
import type { ProviderInfo } from '~/types/model';
import type { BranchMetadata } from '~/lib/agent/types';
import { agentModeStore } from '~/lib/stores/agentMode';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('Messages');

/**
 * Branch parent info for the current chat (set when viewing a forked/branched conversation).
 * Stored in localStorage keyed by urlId so it persists across page reloads.
 */
export const currentBranchParentAtom = atom<{
  parentChatId: string;
  branchPointMessageId: string;
} | null>(null);

/**
 * Map of messageId → number of branches originating from that message in the current chat.
 * Populated on chat load by scanning the 'branches' IndexedDB store.
 */
export const messageBranchCountsAtom = atom<Record<string, number>>({});

/** Queries the 'branches' IndexedDB store index for all branches at a given messageId. */
async function getBranchesByMessageId(database: IDBDatabase, messageId: string): Promise<BranchMetadata[]> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('branches', 'readonly');
    const store = transaction.objectStore('branches');
    const index = store.index('branchPointMessageId');
    const request = index.getAll(messageId);

    request.onsuccess = () => resolve(request.result as BranchMetadata[]);
    request.onerror = () => reject(request.error);
  });
}

interface MessagesProps {
  id?: string;
  className?: string;
  isStreaming?: boolean;
  messages?: Message[];
  append?: (message: Message) => void;
  chatMode?: 'discuss' | 'build';
  setChatMode?: (mode: 'discuss' | 'build') => void;
  model?: string;
  provider?: ProviderInfo;
  addToolResult: ({ toolCallId, result }: { toolCallId: string; result: unknown }) => void;
}

/**
 * Compact badge displayed when the current chat is a branch of another conversation.
 * Shows a link back to the parent chat.
 */
function BranchIndicator({ parentChatId }: { parentChatId: string }) {
  const navigate = useNavigate();

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 mb-2 rounded-md bg-devonz-elements-background-depth-2 border border-devonz-elements-borderColor text-xs">
      <div className="i-ph:git-branch text-devonz-elements-textTertiary w-4 h-4 shrink-0" />
      <span className="text-devonz-elements-textSecondary">Branched from</span>
      <button
        onClick={() => navigate(`/chat/${parentChatId}`)}
        className="text-devonz-elements-item-contentAccent hover:underline truncate max-w-48"
      >
        parent conversation
      </button>
    </div>
  );
}

/**
 * Inline dropdown that lists sibling branches originating from the same message.
 * Branches are lazy-loaded from IndexedDB only when the dropdown opens.
 */
function BranchSelector({ messageId, count }: { messageId: string; count: number }) {
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<BranchMetadata[]>([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleToggle = useCallback(async () => {
    if (open) {
      setOpen(false);
      return;
    }

    if (!db) {
      return;
    }

    setOpen(true);

    if (branches.length === 0) {
      setLoading(true);

      try {
        const result = await getBranchesByMessageId(db, messageId);
        setBranches(result);
      } catch (error) {
        logger.error('Failed to load branches', error);
        toast.error('Failed to load branches');
      } finally {
        setLoading(false);
      }
    }
  }, [open, branches.length, messageId]);

  return (
    <div className="relative mt-1">
      <button
        onClick={handleToggle}
        className={classNames(
          'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors',
          'text-devonz-elements-textTertiary hover:text-devonz-elements-textSecondary',
          'hover:bg-devonz-elements-background-depth-2',
        )}
      >
        <div className="i-ph:git-branch w-3.5 h-3.5" />
        <span>
          {count} {count === 1 ? 'branch' : 'branches'}
        </span>
        <div className={classNames('i-ph:caret-down w-3 h-3 transition-transform', { 'rotate-180': open })} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-40 min-w-56 rounded-lg border border-devonz-elements-borderColor bg-devonz-elements-background-depth-2 shadow-lg overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-3">
              <div className="i-svg-spinners:90-ring-with-bg text-devonz-elements-textTertiary" />
            </div>
          ) : branches.length === 0 ? (
            <div className="px-3 py-2 text-xs text-devonz-elements-textTertiary">No branches found</div>
          ) : (
            branches.map((branch) => (
              <button
                key={branch.branchId}
                onClick={() => {
                  setOpen(false);
                  navigate(`/chat/${branch.branchId}`);
                }}
                className="w-full text-left px-3 py-2 text-xs hover:bg-devonz-elements-background-depth-3 transition-colors flex items-center gap-2"
              >
                <div className="i-ph:git-branch w-3.5 h-3.5 text-devonz-elements-textTertiary shrink-0" />
                <div className="flex flex-col min-w-0">
                  <span className="text-devonz-elements-textPrimary truncate">{branch.label}</span>
                  <span className="text-devonz-elements-textTertiary">
                    {new Date(branch.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

const AGENT_PHASE_COLORS: Record<string, string> = {
  planning: 'bg-blue-500/15 text-blue-400',
  executing: 'bg-green-500/15 text-green-400',
  reviewing: 'bg-amber-500/15 text-amber-400',
};

const AGENT_PHASE_ICONS: Record<string, string> = {
  planning: 'i-ph:notepad',
  executing: 'i-ph:play-circle',
  reviewing: 'i-ph:magnifying-glass',
};

const AGENT_PHASE_LABELS: Record<string, string> = {
  planning: 'Planning',
  executing: 'Executing',
  reviewing: 'Reviewing',
};

/**
 * Inline indicator showing the current agent phase when actively streaming.
 * Displays at the bottom of the messages list during agent sessions.
 */
function AgentPhaseIndicator({ phase }: { phase: string }) {
  if (phase === 'idle') {
    return null;
  }

  const colorClass = AGENT_PHASE_COLORS[phase] ?? 'bg-gray-500/15 text-gray-400';
  const iconClass = AGENT_PHASE_ICONS[phase] ?? 'i-ph:circle';
  const label = AGENT_PHASE_LABELS[phase] ?? phase;

  return (
    <div className="flex items-center gap-2 py-2 px-3 my-1 rounded-md bg-devonz-elements-background-depth-2 border border-devonz-elements-borderColor">
      <div className="i-svg-spinners:90-ring-with-bg text-devonz-elements-textTertiary w-3.5 h-3.5" />
      <div className={classNames('w-4 h-4', iconClass)} />
      <span className={classNames('text-xs font-medium px-1.5 py-0.5 rounded-md', colorClass)}>{label}</span>
      <span className="text-xs text-devonz-elements-textTertiary">in progress</span>
    </div>
  );
}

export const Messages = forwardRef<HTMLDivElement, MessagesProps>(
  (props: MessagesProps, ref: ForwardedRef<HTMLDivElement> | undefined) => {
    const { id, isStreaming = false, messages = [] } = props;
    const location = useLocation();

    // Subscribe to branch state atoms
    const branchParent = useStore(currentBranchParentAtom);
    const branchCounts = useStore(messageBranchCountsAtom);

    // Subscribe to agent phase for inline progress indicator
    const agentState = useStore(agentModeStore);

    // Load branch info when the chat changes
    useEffect(() => {
      const urlIdMatch = location.pathname.match(/\/chat\/(.+)/);
      const currentUrlId = urlIdMatch?.[1];

      // Check if the current chat is a branch (child) by looking up localStorage
      if (currentUrlId) {
        try {
          const stored = localStorage.getItem(`devonz_branch_parent_${currentUrlId}`);

          if (stored) {
            currentBranchParentAtom.set(JSON.parse(stored));
          } else {
            currentBranchParentAtom.set(null);
          }
        } catch {
          currentBranchParentAtom.set(null);
        }
      } else {
        currentBranchParentAtom.set(null);
      }

      // Load branch counts for all messages in this chat (as a parent)
      const currentId = chatId.get();

      if (db && currentId) {
        getBranchesByParentChatId(db, currentId)
          .then((allBranches) => {
            const counts: Record<string, number> = {};

            for (const branch of allBranches) {
              counts[branch.branchPointMessageId] = (counts[branch.branchPointMessageId] || 0) + 1;
            }

            messageBranchCountsAtom.set(counts);
          })
          .catch((error) => {
            logger.error('Failed to load branch counts', error);
            messageBranchCountsAtom.set({});
          });
      } else {
        messageBranchCountsAtom.set({});
      }
    }, [location.pathname]);

    const handleRewind = (messageId: string) => {
      const searchParams = new URLSearchParams(location.search);
      searchParams.set('rewindTo', messageId);
      window.location.search = searchParams.toString();
    };

    const handleFork = async (messageId: string) => {
      try {
        if (!db || !chatId.get()) {
          toast.error('Chat persistence is not available');
          return;
        }

        const parentId = chatId.get()!;
        const urlId = await forkChat(db, parentId, messageId, { branchPointMessageId: messageId });

        // Store parent mapping so the child chat can display its branch indicator
        try {
          localStorage.setItem(
            `devonz_branch_parent_${urlId}`,
            JSON.stringify({ parentChatId: parentId, branchPointMessageId: messageId }),
          );
        } catch {
          // localStorage full or unavailable — branch indicator won't show, but fork still works
        }

        window.location.href = `/chat/${urlId}`;
      } catch (error) {
        toast.error('Failed to fork chat: ' + (error as Error).message);
      }
    };

    return (
      <div id={id} className={props.className} ref={ref}>
        {branchParent && <BranchIndicator parentChatId={branchParent.parentChatId} />}
        {messages.length > 0
          ? messages.map((message, index) => {
              const { role, content, id: messageId, annotations, parts } = message;
              const isUserMessage = role === 'user';
              const isFirst = index === 0;
              const isHidden = annotations?.includes('hidden');

              if (isHidden) {
                return <Fragment key={index} />;
              }

              const branchCount = messageId ? (branchCounts[messageId] ?? 0) : 0;

              return (
                <div
                  key={index}
                  className={classNames('flex gap-4 py-3 w-full rounded-lg', {
                    'mt-4': !isFirst,
                  })}
                >
                  <div className="grid grid-col-1 w-full">
                    {isUserMessage ? (
                      <UserMessage content={content} parts={parts} />
                    ) : (
                      <AssistantMessage
                        content={content}
                        annotations={message.annotations}
                        messageId={messageId}
                        onRewind={handleRewind}
                        onFork={handleFork}
                        append={props.append}
                        chatMode={props.chatMode}
                        setChatMode={props.setChatMode}
                        model={props.model}
                        provider={props.provider}
                        parts={parts}
                        addToolResult={props.addToolResult}
                      />
                    )}
                    {!isUserMessage && messageId && branchCount > 0 && (
                      <BranchSelector messageId={messageId} count={branchCount} />
                    )}
                  </div>
                </div>
              );
            })
          : null}
        {isStreaming && agentState.planPhase !== 'idle' && <AgentPhaseIndicator phase={agentState.planPhase} />}
        {isStreaming && (
          <div className="text-center w-full  text-devonz-elements-item-contentAccent i-svg-spinners:3-dots-fade text-4xl mt-4"></div>
        )}
      </div>
    );
  },
);
