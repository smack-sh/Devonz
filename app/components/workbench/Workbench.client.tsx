import { useStore } from '@nanostores/react';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { computed } from 'nanostores';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import type { FileHistory } from '~/types/actions';
import type { IChatMetadata } from '~/lib/persistence/db';
import {
  type OnChangeCallback as OnEditorChange,
  type OnScrollCallback as OnEditorScroll,
} from '~/components/editor/codemirror/CodeMirrorEditor';
import { IconButton } from '~/components/ui/IconButton';
import { Slider, type SliderOptions } from '~/components/ui/Slider';
import { workbenchStore, type WorkbenchViewType } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';
import { cubicEasingFn } from '~/utils/easings';
import { createScopedLogger, renderLogger } from '~/utils/logger';
import { EditorPanel } from './EditorPanel';
import { Preview } from './Preview';
import { Versions } from './Versions';
import { Plan } from './Plan';
import { StagedChangesPanel } from './StagedChangesPanel';
import { DiffPreviewModal } from './DiffPreviewModal';
import useViewport from '~/lib/hooks';

import { usePreviewStore } from '~/lib/stores/previews';
import { chatStore } from '~/lib/stores/chat';
import type { ElementInfo } from './inspector-types';
import { ExportChatButton } from '~/components/chat/chatExportAndImport/ExportChatButton';
import { useChatHistory } from '~/lib/persistence';
import { streamingState } from '~/lib/stores/streaming';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { usePlanSync } from '~/lib/hooks/usePlanSync';
import { runtime } from '~/lib/runtime';
import { WORK_DIR } from '~/utils/constants';

const workbenchLogger = createScopedLogger('Workbench');

interface WorkspaceProps {
  chatStarted?: boolean;
  isStreaming?: boolean;
  metadata?: {
    gitUrl?: string;
  };
  updateChatMestaData?: (metadata: IChatMetadata) => void;
  setSelectedElement?: (element: ElementInfo | null) => void;

  /** The width of the workbench panel in pixels */
  width?: number;

  /** Whether the workbench should take full width (when chat is hidden) */
  fullWidth?: boolean;
}

const viewTransition = { ease: cubicEasingFn };

const sliderOptions: SliderOptions<WorkbenchViewType> = {
  left: {
    value: 'code',
    text: 'Code',
  },
  right: {
    value: 'preview',
    text: 'Preview',
  },
};

export const Workbench = memo(
  ({
    chatStarted,
    isStreaming,
    metadata: _metadata,
    updateChatMestaData: _updateChatMestaData,
    setSelectedElement,
    width,
    fullWidth,
  }: WorkspaceProps) => {
    renderLogger.trace('Workbench');

    const [fileHistory] = useState<Record<string, FileHistory>>({});

    // const modifiedFiles = Array.from(useStore(workbenchStore.unsavedFiles).keys());

    const hasPreview = useStore(computed(workbenchStore.previews, (previews) => previews.length > 0));
    const showWorkbench = useStore(workbenchStore.showWorkbench);
    const selectedFile = useStore(workbenchStore.selectedFile);
    const currentDocument = useStore(workbenchStore.currentDocument);
    const unsavedFiles = useStore(workbenchStore.unsavedFiles);
    const selectedView = useStore(workbenchStore.currentView);
    const { showChat } = useStore(chatStore);
    const canHideChat = showWorkbench || !showChat;

    // Sync PLAN.md content from project files into the plan store
    usePlanSync();

    const isSmallViewport = useViewport(1024);
    const streaming = useStore(streamingState);
    const { exportChat } = useChatHistory();
    const [isSyncing, setIsSyncing] = useState(false);

    // Auto-refresh preview 2 seconds after LLM response completes
    const prevStreamingRef = useRef(streaming);

    useEffect(() => {
      if (prevStreamingRef.current && !streaming) {
        const timer = setTimeout(() => {
          const previewStore = usePreviewStore();
          previewStore.refreshAllPreviews();

          /*
           * Auto-start static server fallback:
           * If no start action was run and no previews exist, serve static files
           */
          const previews = workbenchStore.previews.get();
          const artifacts = workbenchStore.artifacts.get();
          const hasStartAction = Object.values(artifacts).some((artifact) =>
            Object.values(artifact.runner.actions.get()).some((action) => action.type === 'start'),
          );

          if (!hasStartAction && previews.length === 0) {
            const currentFiles = workbenchStore.files.get();

            const hasPackageJson = Object.keys(currentFiles).some(
              (filePath) => filePath.endsWith('/package.json') && currentFiles[filePath]?.type === 'file',
            );

            const hasShellAction = Object.values(artifacts).some((artifact) =>
              Object.values(artifact.runner.actions.get()).some((action) => action.type === 'shell'),
            );

            if (hasPackageJson && !hasShellAction) {
              workbenchLogger.info(
                'No shell/start action found with package.json — auto-installing and starting dev server',
              );

              let devCommand = 'npm run dev';

              try {
                const pkgEntry = Object.entries(currentFiles).find(([k]) => k.endsWith('/package.json'));

                if (pkgEntry && pkgEntry[1]?.type === 'file') {
                  const pkg = JSON.parse(pkgEntry[1].content || '{}');

                  if (pkg.scripts?.dev) {
                    devCommand = 'npm run dev';
                  } else if (pkg.scripts?.start) {
                    devCommand = 'npm start';
                  } else if (pkg.scripts?.preview) {
                    devCommand = 'npm run preview';
                  }
                }
              } catch {
                // use default
              }

              const shell = workbenchStore.devonzTerminal;

              shell.ready().then(async () => {
                try {
                  await shell.executeCommand('auto-start-install', 'npm install --legacy-peer-deps');
                  shell.executeCommand('auto-start-dev', devCommand);
                } catch (err) {
                  workbenchLogger.error('Auto-start failed:', err);
                }
              });
            } else if (!hasPackageJson) {
              const hasIndexHtml = Object.keys(currentFiles).some(
                (filePath) => filePath.endsWith('/index.html') && currentFiles[filePath]?.type === 'file',
              );

              if (hasIndexHtml) {
                workbenchLogger.info('No start action found — launching static file server for index.html');

                runtime.then((rt) => {
                  rt.spawn('npx', ['--yes', 'serve', '.'], {
                    cwd: WORK_DIR,
                    env: { NODE_ENV: 'development' },
                  }).catch((err) => {
                    workbenchLogger.error('Failed to start static file server:', err);
                  });
                });
              }
            }
          }
        }, 2000);

        prevStreamingRef.current = streaming;

        return () => clearTimeout(timer);
      }

      prevStreamingRef.current = streaming;

      return undefined;
    }, [streaming]);

    const setSelectedView = (view: WorkbenchViewType) => {
      workbenchStore.currentView.set(view);
    };

    useEffect(() => {
      if (hasPreview) {
        setSelectedView('preview');
      }
    }, [hasPreview]);

    const onEditorChange = useCallback<OnEditorChange>((update) => {
      workbenchStore.setCurrentDocumentContent(update.content);
    }, []);

    const onEditorScroll = useCallback<OnEditorScroll>((position) => {
      workbenchStore.setCurrentDocumentScrollPosition(position);
    }, []);

    const onFileSelect = useCallback((filePath: string | undefined) => {
      workbenchStore.setSelectedFile(filePath);
    }, []);

    const onFileSave = useCallback(() => {
      workbenchStore
        .saveCurrentDocument()
        .then(() => {
          // Explicitly refresh all previews after a file save
          const previewStore = usePreviewStore();
          previewStore.refreshAllPreviews();
        })
        .catch(() => {
          toast.error('Failed to update file content');
        });
    }, []);

    const onFileReset = useCallback(() => {
      workbenchStore.resetCurrentDocument();
    }, []);

    const handleSyncFiles = useCallback(async () => {
      setIsSyncing(true);

      try {
        const directoryHandle = await window.showDirectoryPicker();
        await workbenchStore.syncFiles(directoryHandle);
        toast.success('Files synced successfully');
      } catch (error) {
        workbenchLogger.error('Error syncing files:', error);
        toast.error('Failed to sync files');
      } finally {
        setIsSyncing(false);
      }
    }, []);

    return (
      chatStarted &&
      showWorkbench && (
        <div
          className={classNames('h-full z-workbench', {
            'flex-grow': !!fullWidth,
            'flex-shrink-0': !fullWidth,
          })}
          style={fullWidth ? undefined : { width: width || 'var(--workbench-width)' }}
        >
          <div
            className={classNames('h-full flex flex-col bg-devonz-elements-background-depth-2 overflow-hidden', {
              'border-l border-devonz-elements-borderColor': !fullWidth,
            })}
          >
            <div className="flex items-center px-3 py-2.5 border-b border-devonz-elements-borderColor gap-2 bg-devonz-elements-background-depth-2/80">
              <button
                className={`${showChat ? 'i-ph:sidebar-simple-fill' : 'i-ph:sidebar-simple'} text-lg text-devonz-elements-textSecondary hover:text-devonz-elements-textPrimary transition-colors mr-1`}
                disabled={!canHideChat || isSmallViewport}
                onClick={() => {
                  if (canHideChat) {
                    chatStore.setKey('showChat', !showChat);
                  }
                }}
              />
              <Slider selected={selectedView} options={sliderOptions} setSelected={setSelectedView} />

              <div className="ml-auto" />
              {selectedView === 'code' && (
                <div className="flex overflow-y-auto">
                  {/* Export Chat Button */}
                  <ExportChatButton exportChat={exportChat} />

                  {/* Sync Button */}
                  <div className="flex border border-devonz-elements-borderColor rounded-lg overflow-hidden ml-1">
                    <DropdownMenu.Root>
                      <DropdownMenu.Trigger
                        disabled={isSyncing || streaming}
                        className="rounded-lg items-center justify-center [&:is(:disabled,.disabled)]:cursor-not-allowed [&:is(:disabled,.disabled)]:opacity-60 px-3 py-1.5 text-xs bg-devonz-elements-background-depth-3 text-devonz-elements-textPrimary border border-devonz-elements-borderColor hover:bg-devonz-elements-background-depth-4 [&:not(:disabled,.disabled)]:hover:text-accent-400 outline-accent-500 flex gap-1.5 transition-colors"
                      >
                        {isSyncing ? 'Syncing...' : 'Sync'}
                        <span className={classNames('i-ph:caret-down transition-transform')} />
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content
                          className={classNames(
                            'min-w-[240px] z-[9999]',
                            'bg-devonz-elements-background-depth-2',
                            'rounded-lg shadow-lg',
                            'border border-devonz-elements-borderColor',
                            'animate-in fade-in-0 zoom-in-95',
                            'py-1',
                          )}
                          sideOffset={5}
                          align="end"
                        >
                          <DropdownMenu.Item
                            className={classNames(
                              'cursor-pointer flex items-center w-full px-4 py-2 text-sm text-devonz-elements-textPrimary hover:bg-devonz-elements-item-backgroundActive gap-2 rounded-md group relative',
                            )}
                            onClick={handleSyncFiles}
                            disabled={isSyncing}
                          >
                            <div className="flex items-center gap-2">
                              {isSyncing ? <div className="i-ph:spinner" /> : <div className="i-ph:cloud-arrow-down" />}
                              <span>{isSyncing ? 'Syncing...' : 'Sync Files'}</span>
                            </div>
                          </DropdownMenu.Item>
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                  </div>

                  {/* Toggle Terminal Button */}
                  <div className="flex border border-devonz-elements-borderColor rounded-md overflow-hidden ml-1">
                    <button
                      onClick={() => {
                        workbenchStore.toggleTerminal(!workbenchStore.showTerminal.get());
                      }}
                      className="rounded-md items-center justify-center [&:is(:disabled,.disabled)]:cursor-not-allowed [&:is(:disabled,.disabled)]:opacity-60 px-3 py-1.5 text-xs bg-devonz-elements-background-depth-3 text-devonz-elements-textPrimary border border-devonz-elements-borderColor hover:bg-devonz-elements-background-depth-4 [&:not(:disabled,.disabled)]:hover:text-accent-400 outline-accent-500 flex gap-1.7"
                    >
                      <div className="i-ph:terminal" />
                      Toggle Terminal
                    </button>
                  </div>
                </div>
              )}

              <IconButton
                icon="i-ph:x-circle"
                className="-mr-1"
                size="xl"
                aria-label="Close workbench"
                onClick={() => {
                  workbenchStore.showWorkbench.set(false);
                }}
              />
            </div>
            {/* Plan component - shows when planning is active */}
            <Plan />
            {/* Staged changes panel - shows pending file changes */}
            <StagedChangesPanel />
            {/* Diff preview modal - for reviewing individual changes */}
            <DiffPreviewModal />
            <div className="relative flex-1 overflow-hidden">
              <View initial={{ x: '0%' }} animate={{ x: selectedView === 'code' ? '0%' : '-100%' }}>
                <EditorPanel
                  editorDocument={currentDocument}
                  isStreaming={isStreaming}
                  selectedFile={selectedFile}
                  unsavedFiles={unsavedFiles}
                  fileHistory={fileHistory}
                  onFileSelect={onFileSelect}
                  onEditorScroll={onEditorScroll}
                  onEditorChange={onEditorChange}
                  onFileSave={onFileSave}
                  onFileReset={onFileReset}
                />
              </View>
              <View initial={{ x: '100%' }} animate={{ x: selectedView === 'preview' ? '0%' : '100%' }}>
                <Preview setSelectedElement={setSelectedElement} />
              </View>
              <View initial={{ x: '100%' }} animate={{ x: selectedView === 'versions' ? '0%' : '100%' }}>
                <Versions />
              </View>
            </div>
          </div>
        </div>
      )
    );
  },
);

// View component for rendering content with motion transitions
interface ViewProps extends HTMLMotionProps<'div'> {
  children: JSX.Element;
}

const View = memo(({ children, ...props }: ViewProps) => {
  return (
    <motion.div className="absolute inset-0" transition={viewTransition} {...props}>
      {children}
    </motion.div>
  );
});
