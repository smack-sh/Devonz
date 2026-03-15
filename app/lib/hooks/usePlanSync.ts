import { useEffect, useRef } from 'react';
import { setPlan, resetPlan, planStore, type PlanTask } from '~/lib/stores/plan';
import { useFileContent } from '~/lib/hooks/useFileContent';
import { createScopedLogger } from '~/utils/logger';
import type { SubTaskStatus } from '~/lib/agent/types';

const logger = createScopedLogger('PlanSync');

/** Path where the LLM writes PLAN.md inside WebContainer */
const PLAN_MD_PATH = '/home/project/PLAN.md';

/**
 * Parse markdown checkbox content into PlanTask objects.
 *
 * Handles:
 *   - `- [ ] Some task` → not-started (top-level task)
 *   - `- [x] Some task` → completed (top-level task)
 *   - `- [X] Some task` → completed (top-level task)
 *   - Indented checkboxes under a parent → sub-tasks with depth 1 or 2
 *   - Fourth-level or deeper indentation is flattened to depth 2 with a warning
 *   - Lines that don't match the checkbox pattern are ignored.
 *   - An optional `# Title` heading at the top becomes the plan title.
 */
export function parsePlanMd(content: string): { title: string | undefined; tasks: PlanTask[] } {
  const lines = content.split('\n');
  let title: string | undefined;
  const tasks: PlanTask[] = [];
  let indentUnit = 0;
  let currentParentTask: PlanTask | null = null;

  for (const line of lines) {
    // Detect heading as plan title (first heading wins)
    if (!title) {
      const headingMatch = line.match(/^#+\s+(.+)/);

      if (headingMatch) {
        title = headingMatch[1].trim();
        continue;
      }
    }

    // Parse checkbox items — capture leading spaces separately
    const checkboxMatch = line.match(/^( *)([-*])\s+\[([ xX])\]\s+(.+)/);

    if (checkboxMatch) {
      const leadingSpaces = checkboxMatch[1].length;
      const checked = checkboxMatch[3].toLowerCase() === 'x';
      const taskTitle = checkboxMatch[4].trim();

      if (leadingSpaces === 0) {
        // Top-level task (no indentation)
        const task: PlanTask = {
          id: `plan-task-${tasks.length}`,
          title: taskTitle,
          status: checked ? 'completed' : 'not-started',
        };
        tasks.push(task);
        currentParentTask = task;
      } else if (currentParentTask) {
        // Indented checkbox under an existing parent → sub-task
        if (indentUnit === 0) {
          indentUnit = leadingSpaces;
        }

        const nestingLevel = Math.round(leadingSpaces / indentUnit);
        let depth: 1 | 2;

        if (nestingLevel <= 1) {
          depth = 1;
        } else if (nestingLevel === 2) {
          depth = 2;
        } else {
          console.warn(
            `Sub-task "${taskTitle}" has indent level ${nestingLevel} (${leadingSpaces} spaces) — flattening to depth 2`,
          );
          depth = 2;
        }

        if (!currentParentTask.subTasks) {
          currentParentTask.subTasks = [];
        }

        const subTaskIndex = currentParentTask.subTasks.length;
        const subTaskStatus: SubTaskStatus = checked ? 'done' : 'pending';

        currentParentTask.subTasks.push({
          id: `${currentParentTask.id}-sub-${subTaskIndex}`,
          title: taskTitle,
          status: subTaskStatus,
          parentTaskId: currentParentTask.id,
          depth,
        });
      } else {
        // Indented but no preceding parent — treat as top-level task
        const task: PlanTask = {
          id: `plan-task-${tasks.length}`,
          title: taskTitle,
          status: checked ? 'completed' : 'not-started',
        };
        tasks.push(task);
        currentParentTask = task;
      }
    }
  }

  return { title, tasks };
}

/**
 * Serialize PlanTask objects back into PLAN.md markdown.
 *
 * Produces:
 *   - `# Title` heading (if title is provided)
 *   - `- [ ] Task` or `- [x] Task` for each top-level task
 *   - Indented `- [ ] Sub-task` or `- [x] Sub-task` for sub-tasks
 *     (2-space indent per depth level)
 *
 * Round-trip: parsePlanMd(serializePlanMd(title, tasks)) produces identical data.
 */
export function serializePlanMd(title: string | undefined, tasks: PlanTask[]): string {
  const lines: string[] = [];

  if (title) {
    lines.push(`# ${title}`);
    lines.push('');
  }

  for (const task of tasks) {
    const checkbox = task.status === 'completed' ? '[x]' : '[ ]';
    lines.push(`- ${checkbox} ${task.title}`);

    if (task.subTasks) {
      for (const subTask of task.subTasks) {
        const subCheckbox = subTask.status === 'done' ? '[x]' : '[ ]';
        const indentDepth = Math.max(subTask.depth, 1);
        const indent = '  '.repeat(indentDepth);
        lines.push(`${indent}- ${subCheckbox} ${subTask.title}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Hook that watches PLAN.md content via a computed selector and syncs
 * it into the plan store. Uses useFileContent internally so callers
 * don't need to pass the full FileMap — only the PLAN.md file content
 * triggers re-renders.
 */
export function usePlanSync(): void {
  const planContent = useFileContent(PLAN_MD_PATH);
  const prevContentRef = useRef<string | null>(null);

  useEffect(() => {
    if (planContent === undefined) {
      // PLAN.md doesn't exist or was deleted — clear the plan if it was active
      if (prevContentRef.current !== null) {
        logger.info('PLAN.md removed — clearing plan');
        resetPlan();
        prevContentRef.current = null;
      }

      return;
    }

    const content = planContent;

    // Skip if content hasn't changed
    if (content === prevContentRef.current) {
      return;
    }

    prevContentRef.current = content;

    const { title, tasks } = parsePlanMd(content);

    if (tasks.length === 0) {
      logger.debug('PLAN.md has no checkboxes — ignoring');
      return;
    }

    const currentState = planStore.get();

    /*
     * If the plan was already approved, preserve the approval state.
     * During execution the AI checks off tasks in PLAN.md ([ ] → [x]),
     * which triggers this hook. Calling setPlan() would reset approvedByUser
     * to false, breaking the auto-collapse and "Plan Complete" display.
     */
    if (currentState.approvedByUser) {
      logger.info(`PLAN.md updated during execution — ${tasks.length} tasks (preserving approval)`);
      planStore.set({
        ...currentState,
        tasks: tasks.map((task) => ({
          ...task,
          status: task.status || 'not-started',
        })),
        planTitle: title || currentState.planTitle,
      });
    } else {
      logger.info(`PLAN.md updated — ${tasks.length} tasks, title: "${title ?? 'untitled'}"`);
      setPlan(tasks, title);
    }
  }, [planContent]);
}
