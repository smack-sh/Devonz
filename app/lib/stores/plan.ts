import { map, computed, atom } from 'nanostores';
import type { SubTask } from '~/lib/agent/types';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('PlanStore');

/**
 * Action types for plan approval workflow.
 * - 'approve': User approved the plan → trigger execution message
 * - 'reject':  User cancelled the plan → clear plan state
 * - 'modify':  User wants to edit PLAN.md before approving
 * - null:      No pending action
 */
export type PlanAction = 'approve' | 'reject' | 'modify' | null;

/**
 * Atom that fires plan actions. Chat.client.tsx watches this
 * and sends the appropriate follow-up message to the LLM.
 */
export const planActionAtom = atom<PlanAction>(null);

/**
 * Represents a single task in the plan
 */
export interface PlanTask {
  /** Unique identifier for the task */
  id: string;

  /** Short title describing the task */
  title: string;

  /** Optional detailed description of what the task accomplishes */
  description?: string;

  /** Current status of the task */
  status: 'not-started' | 'in-progress' | 'completed';

  /** Files this task will create or modify */
  fileActions?: string[];

  /** IDs of tasks this task depends on (must complete before this task starts) */
  dependsOn?: string[];

  /** Decomposed sub-tasks for granular progress tracking */
  subTasks?: SubTask[];

  /** Estimated effort for this task */
  estimatedEffort?: 'small' | 'medium' | 'large' | null;

  /** Self-review status after task execution */
  reviewStatus?: 'pending' | 'passed' | 'failed' | null;
}

/**
 * State of the planning feature
 */
export interface PlanState {
  /** Whether planning mode is active */
  isActive: boolean;

  /** List of tasks in the plan */
  tasks: PlanTask[];

  /** ID of the currently executing task */
  currentTaskId: string | null;

  /** Whether the user has approved the plan */
  approvedByUser: boolean;

  /** Title of the plan */
  planTitle?: string;
}

/**
 * Initial state for the plan store
 */
const initialState: PlanState = {
  isActive: false,
  tasks: [],
  currentTaskId: null,
  approvedByUser: false,
  planTitle: undefined,
};

/**
 * Main plan store - manages the state of the planning feature
 */
export const planStore = map<PlanState>(initialState);

/**
 * Computed store for progress percentage.
 * Sub-task-aware: tasks with sub-tasks contribute fractional progress
 * based on how many sub-tasks are done, rather than all-or-nothing.
 */
export const planProgress = computed(planStore, (state) => {
  if (state.tasks.length === 0) {
    return 0;
  }

  let totalWeight = 0;

  for (const task of state.tasks) {
    const subs = task.subTasks;

    if (subs && subs.length > 0) {
      const doneCount = subs.filter((s) => s.status === 'done').length;
      totalWeight += doneCount / subs.length;
    } else {
      totalWeight += task.status === 'completed' ? 1 : 0;
    }
  }

  return Math.round((totalWeight / state.tasks.length) * 100);
});

/**
 * Computed store for the current task
 */
export const currentTask = computed(planStore, (state) => {
  if (!state.currentTaskId) {
    return null;
  }

  return state.tasks.find((task) => task.id === state.currentTaskId) ?? null;
});

/**
 * Computed store for whether all tasks are completed
 */
export const allTasksCompleted = computed(planStore, (state) => {
  if (state.tasks.length === 0) {
    return false;
  }

  return state.tasks.every((task) => task.status === 'completed');
});

/**
 * Computed store for pending tasks count
 */
export const pendingTasksCount = computed(planStore, (state) => {
  return state.tasks.filter((task) => task.status !== 'completed').length;
});

/**
 * Computed store for per-task sub-task completion percentage.
 * Returns a Map where each key is a task ID and each value is
 * the completion percentage (0–100) of that task's sub-tasks.
 * Tasks with no sub-tasks derive progress from their own status.
 */
export const subTaskProgress = computed(planStore, (state): Map<string, number> => {
  const progress = new Map<string, number>();

  for (const task of state.tasks) {
    const subs = task.subTasks;

    if (subs && subs.length > 0) {
      const doneCount = subs.filter((s) => s.status === 'done').length;
      progress.set(task.id, Math.round((doneCount / subs.length) * 100));
    } else {
      progress.set(task.id, task.status === 'completed' ? 100 : 0);
    }
  }

  return progress;
});

/**
 * Computed store for topologically sorted task IDs respecting dependsOn.
 * Uses Kahn's algorithm with cycle detection. If a dependency cycle is
 * detected, cyclic tasks are appended in their original order and a
 * warning is logged.
 */
export const taskExecutionOrder = computed(planStore, (state): string[] => {
  const tasks = state.tasks;

  if (tasks.length === 0) {
    return [];
  }

  const taskIds = new Set(tasks.map((t) => t.id));
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const task of tasks) {
    inDegree.set(task.id, 0);
    dependents.set(task.id, []);
  }

  for (const task of tasks) {
    const deps = task.dependsOn ?? [];

    for (const dep of deps) {
      if (taskIds.has(dep)) {
        inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
        dependents.get(dep)!.push(task.id);
      }
    }
  }

  // Kahn's algorithm: process nodes with zero in-degree
  const queue: string[] = [];

  for (const [id, degree] of inDegree) {
    if (degree === 0) {
      queue.push(id);
    }
  }

  const sorted: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);

    for (const dependent of dependents.get(current) ?? []) {
      const newDegree = (inDegree.get(dependent) ?? 1) - 1;
      inDegree.set(dependent, newDegree);

      if (newDegree === 0) {
        queue.push(dependent);
      }
    }
  }

  // Cycle detection: if not all tasks were sorted, a cycle exists
  if (sorted.length < tasks.length) {
    logger.warn('Cycle detected in task dependencies — appending cyclic tasks in original order');

    const sortedSet = new Set(sorted);

    for (const task of tasks) {
      if (!sortedSet.has(task.id)) {
        sorted.push(task.id);
      }
    }
  }

  return sorted;
});

/**
 * Computed store for the next executable task — the first pending (not-started)
 * task whose dependsOn tasks are all 'completed', ordered by topological sort.
 */
export const nextExecutableTask = computed(
  [planStore, taskExecutionOrder],
  (state, executionOrder): PlanTask | null => {
    if (state.tasks.length === 0) {
      return null;
    }

    const taskMap = new Map<string, PlanTask>();

    for (const task of state.tasks) {
      taskMap.set(task.id, task);
    }

    for (const taskId of executionOrder) {
      const task = taskMap.get(taskId);

      if (!task || task.status !== 'not-started') {
        continue;
      }

      const deps = task.dependsOn ?? [];
      const allDepsCompleted = deps.every((depId) => {
        const depTask = taskMap.get(depId);
        return depTask?.status === 'completed';
      });

      if (allDepsCompleted) {
        return task;
      }
    }

    return null;
  },
);

/**
 * Computed store for plan effort summary — counts tasks by estimatedEffort.
 */
export const planEffortSummary = computed(planStore, (state): { small: number; medium: number; large: number } => {
  let small = 0;
  let medium = 0;
  let large = 0;

  for (const task of state.tasks) {
    switch (task.estimatedEffort) {
      case 'small':
        small++;
        break;
      case 'medium':
        medium++;
        break;
      case 'large':
        large++;
        break;
    }
  }

  return { small, medium, large };
});

/**
 * Set the plan with a list of tasks
 */
export function setPlan(tasks: PlanTask[], title?: string): void {
  planStore.set({
    isActive: true,
    tasks: tasks.map((task) => ({
      ...task,
      status: task.status || 'not-started',
    })),
    currentTaskId: null,
    approvedByUser: false,
    planTitle: title,
  });
}

/**
 * Add a single task to the plan
 */
export function addTask(task: Omit<PlanTask, 'status'> & { status?: PlanTask['status'] }): void {
  const currentState = planStore.get();

  planStore.set({
    ...currentState,
    isActive: true,
    tasks: [
      ...currentState.tasks,
      {
        ...task,
        status: task.status || 'not-started',
      },
    ],
  });
}

/**
 * Update the status of a specific task
 */
export function updateTaskStatus(taskId: string, status: PlanTask['status']): void {
  const currentState = planStore.get();
  const taskIndex = currentState.tasks.findIndex((task) => task.id === taskId);

  if (taskIndex === -1) {
    logger.warn(`Task with id "${taskId}" not found`);
    return;
  }

  const updatedTasks = [...currentState.tasks];
  updatedTasks[taskIndex] = {
    ...updatedTasks[taskIndex],
    status,
  };

  // If setting to in-progress, update currentTaskId
  const newCurrentTaskId = status === 'in-progress' ? taskId : currentState.currentTaskId;

  planStore.set({
    ...currentState,
    tasks: updatedTasks,
    currentTaskId: newCurrentTaskId,
  });
}

/**
 * Set the current task by ID
 */
export function setCurrentTask(taskId: string | null): void {
  const currentState = planStore.get();

  planStore.set({
    ...currentState,
    currentTaskId: taskId,
  });
}

/**
 * Mark the plan as approved by the user and fire the approval action.
 * Chat.client.tsx watches planActionAtom and sends the execute message.
 */
export function approvePlan(): void {
  const currentState = planStore.get();

  planStore.set({
    ...currentState,
    approvedByUser: true,
  });

  logger.info('Plan approved — firing approval action');
  planActionAtom.set('approve');
}

/**
 * Reject/cancel the plan and fire the reject action.
 */
export function rejectPlan(): void {
  logger.info('Plan rejected — clearing plan state');
  planActionAtom.set('reject');
  planStore.set(initialState);
}

/**
 * Request to modify the plan — opens PLAN.md for editing.
 */
export function modifyPlan(): void {
  logger.info('Plan modification requested');
  planActionAtom.set('modify');
}

/**
 * Clear the plan action atom after it has been consumed.
 */
export function clearPlanAction(): void {
  planActionAtom.set(null);
}

/**
 * Reset the plan to initial state
 */
export function resetPlan(): void {
  planStore.set(initialState);
}

/**
 * Get the next pending task (first task that is not-started)
 */
export function getNextPendingTask(): PlanTask | null {
  const currentState = planStore.get();

  return currentState.tasks.find((task) => task.status === 'not-started') ?? null;
}

/**
 * Advance to the next task - marks current as completed and next as in-progress
 */
export function advanceToNextTask(): PlanTask | null {
  const currentState = planStore.get();

  // Find and complete current task
  if (currentState.currentTaskId) {
    updateTaskStatus(currentState.currentTaskId, 'completed');
  }

  // Find next pending task
  const nextTask = getNextPendingTask();

  if (nextTask) {
    updateTaskStatus(nextTask.id, 'in-progress');
    return nextTask;
  }

  // No more tasks - clear current task
  setCurrentTask(null);

  return null;
}

/**
 * Update a task's details
 */
export function updateTask(taskId: string, updates: Partial<Omit<PlanTask, 'id'>>): void {
  const currentState = planStore.get();
  const taskIndex = currentState.tasks.findIndex((task) => task.id === taskId);

  if (taskIndex === -1) {
    logger.warn(`Task with id "${taskId}" not found`);
    return;
  }

  const updatedTasks = [...currentState.tasks];
  updatedTasks[taskIndex] = {
    ...updatedTasks[taskIndex],
    ...updates,
  };

  planStore.set({
    ...currentState,
    tasks: updatedTasks,
  });
}

/**
 * Remove a task from the plan
 */
export function removeTask(taskId: string): void {
  const currentState = planStore.get();

  planStore.set({
    ...currentState,
    tasks: currentState.tasks.filter((task) => task.id !== taskId),
    currentTaskId: currentState.currentTaskId === taskId ? null : currentState.currentTaskId,
  });
}

/**
 * Reorder tasks in the plan
 */
export function reorderTasks(fromIndex: number, toIndex: number): void {
  const currentState = planStore.get();
  const tasks = [...currentState.tasks];

  const [removed] = tasks.splice(fromIndex, 1);
  tasks.splice(toIndex, 0, removed);

  planStore.set({
    ...currentState,
    tasks,
  });
}
