import * as Popover from '@radix-ui/react-popover';
import { useState } from 'react';
import { useStore } from '@nanostores/react';
import { classNames } from '~/utils/classNames';
import { agentModeStore, toggleAgentMode } from '~/lib/stores/agentMode';
import { IconButton } from '~/components/ui/IconButton';

type AgentMode = 'standard' | 'agent';

const agentModes: { id: AgentMode; icon: string; label: string; description: string }[] = [
  { id: 'standard', icon: 'i-ph:cursor-click', label: 'Standard', description: 'Normal AI assistant mode' },
  { id: 'agent', icon: 'i-devonz:mode', label: 'Agent', description: 'Autonomous AI agent with tools' },
];

/**
 * Popover selector for Standard ↔ Agent mode, matching the ChatModeSelector pattern.
 */
export function AgentToggle() {
  const [open, setOpen] = useState(false);
  const agentState = useStore(agentModeStore);
  const enabled = agentState.settings.enabled;

  const activeMode: AgentMode = enabled ? 'agent' : 'standard';
  const activeModeConfig = agentModes.find((m) => m.id === activeMode)!;

  const handleSelect = (mode: AgentMode) => {
    toggleAgentMode(mode === 'agent');
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <IconButton
          title="Agent mode"
          className={classNames(
            'transition-all flex items-center gap-1 px-1.5',
            enabled
              ? 'bg-devonz-elements-item-backgroundAccent text-devonz-elements-item-contentAccent'
              : 'bg-devonz-elements-item-backgroundDefault text-devonz-elements-item-contentDefault',
          )}
        >
          <div className={classNames(activeModeConfig.icon, 'text-xl')} />
          <span className="text-xs">Mode</span>
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
            {agentModes.map((mode) => (
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
