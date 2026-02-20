import * as Tooltip from '@radix-ui/react-tooltip';
import { memo } from 'react';
import { classNames } from '~/utils/classNames';
import type { TabVisibilityConfig } from '~/components/@settings/core/types';
import { TAB_LABELS, TAB_ICONS } from '~/components/@settings/core/constants';

interface TabTileProps {
  tab: TabVisibilityConfig;
  onClick?: () => void;
  isActive?: boolean;
  hasUpdate?: boolean;
  statusMessage?: string;
  description?: string;
  isLoading?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export const TabTile = memo(
  ({ tab, onClick, isActive, hasUpdate, statusMessage, description, isLoading, className, children }: TabTileProps) => {
    const IconComponent = TAB_ICONS[tab.id];

    return (
      <Tooltip.Provider delayDuration={200}>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <div className={classNames('min-h-[160px] list-none', className || '')}>
              <div className="relative h-full rounded-xl border border-devonz-elements-borderColor hover:border-devonz-elements-borderColorActive/30 transition-colors duration-150">
                <div
                  onClick={onClick}
                  className={classNames(
                    'relative flex flex-col items-center justify-center h-full p-4 rounded-lg',
                    'bg-devonz-elements-bg-depth-1',
                    'group cursor-pointer',
                    'hover:bg-devonz-elements-bg-depth-2',
                    'transition-colors duration-150',
                    isActive ? 'bg-devonz-elements-item-backgroundAccent' : '',
                    isLoading ? 'cursor-wait opacity-70 pointer-events-none' : '',
                  )}
                >
                  {/* Icon */}
                  <div
                    className={classNames(
                      'relative',
                      'w-14 h-14',
                      'flex items-center justify-center',
                      'rounded-xl',
                      'bg-gray-100 dark:bg-gray-800',
                      'ring-1 ring-gray-200 dark:ring-gray-700',
                      'group-hover:bg-devonz-elements-item-backgroundAccent',
                      'group-hover:ring-devonz-elements-borderColorActive/30',
                      'transition-colors duration-150',
                      isActive ? 'bg-devonz-elements-item-backgroundAccent ring-devonz-elements-borderColorActive/30' : '',
                    )}
                  >
                    <IconComponent
                      className={classNames(
                        'w-8 h-8',
                        'text-gray-600 dark:text-gray-300',
                        'group-hover:text-devonz-elements-item-contentAccent',
                        'transition-colors duration-150',
                        isActive ? 'text-devonz-elements-item-contentAccent' : '',
                      )}
                    />
                  </div>

                  {/* Label and Description */}
                  <div className="flex flex-col items-center mt-4 w-full">
                    <h3
                      className={classNames(
                        'text-[15px] font-medium leading-snug mb-2',
                        'text-gray-700 dark:text-gray-200',
                        'group-hover:text-devonz-elements-item-contentAccent',
                        'transition-colors duration-150',
                        isActive ? 'text-devonz-elements-item-contentAccent' : '',
                      )}
                    >
                      {TAB_LABELS[tab.id]}
                    </h3>
                    {description && (
                      <p
                        className={classNames(
                          'text-[13px] leading-relaxed',
                          'text-gray-500 dark:text-gray-400',
                          'max-w-[85%]',
                          'text-center',
                          'group-hover:text-devonz-elements-item-contentAccent',
                          'transition-colors duration-150',
                          isActive ? 'text-devonz-elements-item-contentAccent' : '',
                        )}
                      >
                        {description}
                      </p>
                    )}
                  </div>

                  {/* Update Indicator with Tooltip */}
                  {hasUpdate && (
                    <>
                      <div className="absolute top-4 right-4 w-2 h-2 rounded-full bg-devonz-elements-item-contentAccent animate-pulse" />
                      <Tooltip.Portal>
                        <Tooltip.Content
                          className={classNames(
                            'px-3 py-1.5 rounded-lg',
                            'bg-[#18181B] text-white',
                            'text-sm font-medium',
                            'select-none',
                            'z-[100]',
                          )}
                          side="top"
                          sideOffset={5}
                        >
                          {statusMessage}
                          <Tooltip.Arrow className="fill-[#18181B]" />
                        </Tooltip.Content>
                      </Tooltip.Portal>
                    </>
                  )}

                  {/* Children (e.g. Beta Label) */}
                  {children}
                </div>
              </div>
            </div>
          </Tooltip.Trigger>
        </Tooltip.Root>
      </Tooltip.Provider>
    );
  },
);
