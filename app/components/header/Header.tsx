import { Suspense } from 'react';
import { useStore } from '@nanostores/react';
import { chatStore } from '~/lib/stores/chat';
import { sidebarStore } from '~/lib/stores/sidebar';
import { planStore } from '~/lib/stores/plan';
import { classNames } from '~/utils/classNames';
import { PanelErrorBoundary } from '~/components/ui/PanelErrorBoundary';
import { clientLazy } from '~/utils/react';

const ChatDescription = clientLazy(() =>
  import('~/lib/persistence/ChatDescription.client').then((m) => ({ default: m.ChatDescription })),
);
const HeaderActionButtons = clientLazy(() =>
  import('./HeaderActionButtons.client').then((m) => ({ default: m.HeaderActionButtons })),
);

export function Header() {
  const chat = useStore(chatStore);
  const sidebarOpen = useStore(sidebarStore.open);
  const plan = useStore(planStore);

  return (
    <header
      className={classNames('flex items-center px-5 border-b h-[var(--header-height)] flex-shrink-0 bg-transparent', {
        'border-transparent': !chat.started,
        'border-devonz-elements-borderColor': chat.started,
      })}
    >
      <PanelErrorBoundary panelName="header">
        <div className="flex items-center gap-3 z-logo text-devonz-elements-textPrimary cursor-pointer">
          {!sidebarOpen && (
            <button
              type="button"
              aria-label="Open sidebar"
              className="flex items-center justify-center bg-transparent border-none p-1 cursor-pointer"
              onClick={() => sidebarStore.toggle()}
            >
              <div className="i-ph:sidebar-simple text-xl text-devonz-elements-textSecondary hover:text-devonz-elements-textPrimary transition-colors" />
            </button>
          )}
        </div>
        {chat.started && (
          <>
            <span className="flex-1 px-4 truncate text-center text-devonz-elements-textSecondary text-sm flex items-center justify-center gap-2">
              <Suspense fallback={null}>
                <ChatDescription />
              </Suspense>
              {plan.isActive && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 text-xs font-medium whitespace-nowrap">
                  <span className="i-ph:list-checks-fill text-xs" />
                  Plan
                </span>
              )}
            </span>
            <Suspense fallback={null}>
              <div className="">
                <HeaderActionButtons chatStarted={chat.started} />
              </div>
            </Suspense>
          </>
        )}
      </PanelErrorBoundary>
    </header>
  );
}
