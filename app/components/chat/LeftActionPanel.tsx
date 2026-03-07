import { lazy, Suspense } from 'react';
import type { Message } from 'ai';
import { toast } from 'react-toastify';
import { ImportFolderButton } from '~/components/chat/ImportFolderButton';
import { Button } from '~/components/ui/Button';
import { classNames } from '~/utils/classNames';
import type { ImportChatFn } from '~/lib/persistence/db';

const GitCloneButton = lazy(() => import('./GitCloneButton'));

type ChatData = {
  messages?: Message[];
  description?: string;
};

interface LeftActionPanelProps {
  importChat?: ImportChatFn;
}

export function LeftActionPanel({ importChat }: LeftActionPanelProps) {
  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];

    if (file && importChat) {
      try {
        const reader = new FileReader();

        reader.onload = async (event) => {
          try {
            const content = event.target?.result as string;
            const data = JSON.parse(content) as ChatData;

            if (Array.isArray(data.messages)) {
              await importChat(data.description || 'Imported Chat', data.messages);
              toast.success('Chat imported successfully');

              return;
            }

            toast.error('Invalid chat file format');
          } catch (error: unknown) {
            if (error instanceof Error) {
              toast.error('Failed to parse chat file: ' + error.message);
            } else {
              toast.error('Failed to parse chat file');
            }
          }
        };

        reader.onerror = () => toast.error('Failed to read chat file');
        reader.readAsText(file);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to import chat');
      }

      e.target.value = '';
    } else {
      toast.error('Something went wrong');
    }
  };

  const buttonBaseClass = classNames(
    '!flex w-full items-center gap-2 justify-center',
    'text-devonz-elements-textSecondary hover:text-devonz-elements-textPrimary',
    'border border-devonz-elements-borderColor hover:border-devonz-elements-borderColorActive',
    'h-10 px-4 py-2',
    'transition-all duration-200 ease-in-out',
    'rounded-lg text-sm font-medium',
    'hover:bg-devonz-elements-bg-depth-3',
  );

  const primaryButtonClass = classNames(
    '!flex w-full items-center gap-2 justify-center',
    'text-devonz-elements-textPrimary',
    'bg-gradient-to-r from-[#1e3a5f] to-[#2d4a6f]',
    'border border-devonz-elements-borderColor hover:border-devonz-elements-borderColorActive',
    'h-10 px-4 py-2',
    'transition-all duration-200 ease-in-out',
    'rounded-lg text-sm font-medium',
    'hover:from-[#2a4a6f] hover:to-[#3d5a7f]',
    'shadow-[0_2px_8px_rgba(30,58,95,0.3)]',
  );

  return (
    <div className="grid grid-cols-3 gap-3 w-full max-w-xl items-stretch">
      {/* Hidden file input */}
      <input type="file" id="chat-import-left" className="hidden" accept=".json" onChange={handleFileImport} />

      {/* Import Chat Button */}
      <div className="flex h-10">
        <Button
          onClick={() => {
            const input = document.getElementById('chat-import-left');
            input?.click();
          }}
          variant="default"
          className={buttonBaseClass}
          style={{ backgroundColor: 'var(--devonz-elements-bg-depth-3)', width: '100%', height: '100%' }}
        >
          <span className="i-ph:upload-simple w-4 h-4" />
          <span>Import Chat</span>
        </Button>
      </div>

      {/* Import Folder Button */}
      <div className="flex h-10">
        <ImportFolderButton
          importChat={importChat}
          className={buttonBaseClass}
          style={{ backgroundColor: 'var(--devonz-elements-bg-depth-3)', width: '100%', height: '100%' }}
        />
      </div>

      {/* Clone a Repo Button - Primary/Highlighted */}
      <div className="flex h-10">
        <Suspense>
          <GitCloneButton
            importChat={importChat}
            className={primaryButtonClass}
            style={{ width: '100%', height: '100%' }}
          />
        </Suspense>
      </div>
    </div>
  );
}
