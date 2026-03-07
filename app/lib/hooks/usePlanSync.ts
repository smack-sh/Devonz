import { useEffect, useRef } from 'react';
import { setPlan, resetPlan, planStore, type PlanTask } from '~/lib/stores/plan';
import { useFileContent } from '~/lib/hooks/useFileContent';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('PlanSync');

/** Path where the LLM writes PLAN.md inside WebContainer */
const PLAN_MD_PATH = '/home/project/PLAN.md';

/**
 * Parse markdown checkbox content into PlanTask objects.
 *
 * Handles:
 *   - `- [ ] Some task` → not-started
 *   - `- [x] Some task` → completed
 *   - `- [X] Some task` → completed
 *   - Lines that don't match the checkbox pattern are ignored.
 *   - An optional `# Title` heading at the top becomes the plan title.
 */
export function parsePlanMd(content: string): { title: string | undefined; tasks: PlanTask[] } {
  const lines = content.split('\n');
  let title: string | undefined;
  const tasks: PlanTask[] = [];

  for (const line of lines) {
    // Detect heading as plan title (first heading wins)
    if (!title) {
      const headingMatch = line.match(/^#+\s+(.+)/);

      if (headingMatch) {
        title = headingMatch[1].trim();
        continue;
      }
    }

    // Parse checkbox items
    const checkboxMatch = line.match(/^[\s]*[-*]\s+\[([ xX])\]\s+(.+)/);

    if (checkboxMatch) {
      const checked = checkboxMatch[1].toLowerCase() === 'x';
      const taskTitle = checkboxMatch[2].trim();

      tasks.push({
        id: `plan-task-${tasks.length}`,
        title: taskTitle,
        status: checked ? 'completed' : 'not-started',
      });
    }
  }

  return { title, tasks };
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
