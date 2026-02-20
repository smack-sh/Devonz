import * as Popover from '@radix-ui/react-popover';
import { useState } from 'react';
import { classNames } from '~/utils/classNames';
import { IconButton } from '~/components/ui/IconButton';

type ChatMode = 'build' | 'plan' | 'discuss';

interface ChatModeSelectorProps {
  chatMode?: 'discuss' | 'build';
  setChatMode?: (mode: 'discuss' | 'build') => void;
  planMode?: boolean;
  setPlanMode?: (enabled: boolean) => void;
}

const modes: { id: ChatMode; icon: string; label: string; description: string }[] = [
  { id: 'build', icon: 'i-ph:lightning', label: 'Build', description: 'Write code and create files' },
  { id: 'plan', icon: 'i-ph:list-checks', label: 'Plan', description: 'Create a plan first, then build' },
  { id: 'discuss', icon: 'i-ph:chats', label: 'Discuss', description: 'Chat without code changes' },
];

export function ChatModeSelector({ chatMode, setChatMode, planMode, setPlanMode }: ChatModeSelectorProps) {
  const [open, setOpen] = useState(false);

  // Derive active mode from the two separate state props
  const activeMode: ChatMode = planMode ? 'plan' : chatMode === 'discuss' ? 'discuss' : 'build';
  const activeModeConfig = modes.find((m) => m.id === activeMode)!;

  const handleSelect = (mode: ChatMode) => {
    switch (mode) {
      case 'build':
        setPlanMode?.(false);
        setChatMode?.('build');
        break;
      case 'plan':
        setPlanMode?.(true);
        setChatMode?.('build');
        break;
      case 'discuss':
        setPlanMode?.(false);
        setChatMode?.('discuss');
        break;
    }

    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <IconButton
          title="Chat mode"
          className={classNames(
            'transition-all flex items-center gap-1 px-1.5',
            activeMode !== 'build'
              ? 'bg-devonz-elements-item-backgroundAccent text-devonz-elements-item-contentAccent'
              : 'bg-devonz-elements-item-backgroundDefault text-devonz-elements-item-contentDefault',
          )}
        >
          <div className={classNames(activeModeConfig.icon, 'text-xl')} />
          <span className="text-xs">{activeModeConfig.label}</span>
        </IconButton>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={8}
          side="top"
          align="start"
          className="rounded-lg z-workbench border border-[#1e293b] overflow-hidden min-w-[200px]"
          style={{ backgroundColor: '#0f1219', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}
        >
          <div className="p-1" style={{ backgroundColor: '#0f1219' }}>
            {modes.map((mode) => (
              <button
                key={mode.id}
                className={classNames(
                  'w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors border-none',
                  activeMode === mode.id
                    ? 'bg-devonz-elements-item-backgroundAccent text-devonz-elements-item-contentAccent'
                    : 'bg-transparent text-[#9ca3af] hover:bg-[#1a1f2e] hover:text-white',
                )}
                onClick={() => handleSelect(mode.id)}
              >
                <div className={classNames(mode.icon, 'text-lg flex-shrink-0')} />
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{mode.label}</span>
                  <span className="text-xs opacity-70">{mode.description}</span>
                </div>
                {activeMode === mode.id && <div className="i-ph:check ml-auto text-lg flex-shrink-0" />}
              </button>
            ))}
          </div>
          <Popover.Arrow className="fill-[#0f1219]" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
