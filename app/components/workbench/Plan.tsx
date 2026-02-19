import React, { memo, useCallback, useEffect } from 'react';
import { useStore } from '@nanostores/react';
import { motion, AnimatePresence } from 'framer-motion';
import { planStore, planProgress, approvePlan, rejectPlan, modifyPlan, type PlanTask } from '~/lib/stores/plan';
import { classNames } from '~/utils/classNames';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '~/components/ui/Collapsible';
import { Button } from '~/components/ui/Button';
import { Progress } from '~/components/ui/Progress';

interface PlanProps {
  className?: string;
}

/**
 * Status icon component for task status
 */
const StatusIcon = memo(({ status }: { status: PlanTask['status'] }) => {
  switch (status) {
    case 'completed':
      return (
        <div className="w-5 h-5 rounded-full bg-green-500/20 flex items-center justify-center">
          <div className="i-ph:check-bold text-green-500 text-sm" />
        </div>
      );
    case 'in-progress':
      return (
        <div className="w-5 h-5 rounded-full bg-blue-500/20 flex items-center justify-center">
          <div className="i-svg-spinners:90-ring-with-bg text-blue-500 text-sm" />
        </div>
      );
    default:
      return <div className="w-5 h-5 rounded-full border-2 border-bolt-elements-borderColor bg-transparent" />;
  }
});

StatusIcon.displayName = 'StatusIcon';

/**
 * Individual task item component
 */
const TaskItem = memo(({ task, index }: { task: PlanTask; index: number }) => {
  const statusColors = {
    'not-started': 'text-bolt-elements-textSecondary',
    'in-progress': 'text-blue-500',
    completed: 'text-green-500',
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className={classNames(
        'flex items-start gap-3 p-3 rounded-lg transition-colors',
        task.status === 'in-progress'
          ? 'bg-blue-500/10 border border-blue-500/30'
          : 'bg-bolt-elements-background-depth-2 border border-transparent',
      )}
    >
      <StatusIcon status={task.status} />

      <div className="flex-1 min-w-0">
        <div
          className={classNames(
            'font-medium text-sm',
            task.status === 'completed' ? 'line-through opacity-60' : '',
            statusColors[task.status],
          )}
        >
          {task.title}
        </div>

        {task.description && (
          <div className="text-xs text-bolt-elements-textSecondary mt-1 line-clamp-2">{task.description}</div>
        )}

        {task.fileActions && task.fileActions.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {task.fileActions.map((file) => (
              <span
                key={file}
                className="text-xs px-1.5 py-0.5 rounded bg-bolt-elements-background-depth-3 text-bolt-elements-textSecondary font-mono"
              >
                {file}
              </span>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
});

TaskItem.displayName = 'TaskItem';

/**
 * Plan approval buttons component — drives the two-phase plan workflow.
 * - Approve & Execute: fires planActionAtom('approve') → Chat sends execute message
 * - Modify: opens PLAN.md in editor for the user to edit
 * - Cancel: clears the plan state
 */
const PlanActions = memo(({ approvedByUser, progress }: { approvedByUser: boolean; progress: number }) => {
  const handleApprove = useCallback(() => {
    approvePlan();
  }, []);

  const handleModify = useCallback(() => {
    modifyPlan();
  }, []);

  const handleReject = useCallback(() => {
    rejectPlan();
  }, []);

  // All tasks done — show completion status, no buttons needed
  if (progress >= 100) {
    return (
      <div className="flex items-center gap-2 text-sm text-green-500">
        <div className="i-ph:check-circle-fill" />
        <span>Plan Complete — All tasks done</span>
      </div>
    );
  }

  if (approvedByUser) {
    return (
      <div className="flex items-center gap-2 text-sm text-green-500">
        <div className="i-ph:check-circle-fill" />
        <span>Plan Approved — Executing...</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="default"
        size="sm"
        onClick={handleApprove}
        className="bg-green-600 hover:bg-green-700 text-white"
      >
        <div className="i-ph:play-fill mr-1" />
        Approve &amp; Execute
      </Button>
      <Button variant="outline" size="sm" onClick={handleModify}>
        <div className="i-ph:pencil-simple mr-1" />
        Modify
      </Button>
      <Button variant="outline" size="sm" onClick={handleReject}>
        <div className="i-ph:x-bold mr-1" />
        Cancel
      </Button>
    </div>
  );
});

PlanActions.displayName = 'PlanActions';

/**
 * Main Plan component - displays the planning checklist in the workbench
 */
export const Plan = memo(({ className }: PlanProps) => {
  const state = useStore(planStore);
  const progress = useStore(planProgress);

  // Start collapsed if all tasks are already done (e.g. page reload)
  const [isOpen, setIsOpen] = React.useState(progress < 100);

  // Auto-collapse the plan panel after all tasks complete
  useEffect(() => {
    if (progress >= 100) {
      const timer = setTimeout(() => setIsOpen(false), 3000);
      return () => clearTimeout(timer);
    }

    return undefined;
  }, [progress]);

  if (!state.isActive || state.tasks.length === 0) {
    return null;
  }

  const completedCount = state.tasks.filter((t) => t.status === 'completed').length;
  const totalCount = state.tasks.length;

  return (
    <div className={classNames('border-b border-bolt-elements-borderColor', className)}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <button
            className={classNames(
              'w-full flex items-center justify-between p-4',
              'bg-bolt-elements-background-depth-1 hover:bg-bolt-elements-background-depth-2',
              'transition-colors cursor-pointer',
            )}
          >
            <div className="flex items-center gap-3">
              <div className="i-ph:list-checks-fill text-xl text-bolt-elements-textPrimary" />
              <div className="text-left">
                <h3 className="font-semibold text-bolt-elements-textPrimary">
                  {state.planTitle || 'Implementation Plan'}
                </h3>
                <p className="text-xs text-bolt-elements-textSecondary">
                  {completedCount} of {totalCount} tasks completed
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              {/* Progress indicator */}
              <div className="flex items-center gap-2">
                <div className="w-24 hidden sm:block">
                  <Progress value={progress} />
                </div>
                <span className="text-sm font-medium text-bolt-elements-textSecondary">{progress}%</span>
              </div>

              {/* Chevron */}
              <div
                className={classNames(
                  'i-ph:caret-down text-bolt-elements-textSecondary transition-transform',
                  isOpen ? 'rotate-180' : '',
                )}
              />
            </div>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <AnimatePresence>
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="p-4 pt-0 space-y-3"
            >
              {/* Task list */}
              <div className="space-y-2">
                {state.tasks.map((task, index) => (
                  <TaskItem key={task.id} task={task} index={index} />
                ))}
              </div>

              {/* Approval actions */}
              <div className="pt-3 border-t border-bolt-elements-borderColor">
                <PlanActions approvedByUser={state.approvedByUser} progress={progress} />
              </div>
            </motion.div>
          </AnimatePresence>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
});

Plan.displayName = 'Plan';

export default Plan;
