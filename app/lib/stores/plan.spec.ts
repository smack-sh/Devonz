import { describe, it, expect, beforeEach } from 'vitest';
import {
  planStore,
  planProgress,
  planActionAtom,
  setPlan,
  approvePlan,
  rejectPlan,
  modifyPlan,
  clearPlanAction,
  resetPlan,
  addTask,
  updateTaskStatus,
  getNextPendingTask,
  advanceToNextTask,
  type PlanTask,
} from './plan';

const makeTasks = (count: number, allCompleted = false): PlanTask[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `task-${i}`,
    title: `Task ${i}`,
    status: allCompleted ? 'completed' : 'not-started',
  }));

describe('PlanStore', () => {
  beforeEach(() => {
    resetPlan();
    clearPlanAction();
  });

  // ── setPlan ──────────────────────────────────────────────

  it('setPlan activates the store with tasks and title', () => {
    const tasks = makeTasks(3);
    setPlan(tasks, 'My Plan');

    const state = planStore.get();
    expect(state.isActive).toBe(true);
    expect(state.tasks).toHaveLength(3);
    expect(state.planTitle).toBe('My Plan');
    expect(state.approvedByUser).toBe(false);
  });

  it('setPlan defaults task status to not-started', () => {
    setPlan([{ id: '1', title: 'A' } as PlanTask]);
    expect(planStore.get().tasks[0].status).toBe('not-started');
  });

  // ── planProgress computed ────────────────────────────────

  it('planProgress returns 0 when no tasks', () => {
    expect(planProgress.get()).toBe(0);
  });

  it('planProgress returns correct percentage', () => {
    setPlan([
      { id: '1', title: 'A', status: 'completed' },
      { id: '2', title: 'B', status: 'not-started' },
      { id: '3', title: 'C', status: 'completed' },
      { id: '4', title: 'D', status: 'not-started' },
    ]);
    expect(planProgress.get()).toBe(50);
  });

  it('planProgress returns 100 when all completed', () => {
    setPlan(makeTasks(3, true));
    expect(planProgress.get()).toBe(100);
  });

  // ── approvePlan ──────────────────────────────────────────

  it('approvePlan sets approvedByUser and fires action atom', () => {
    setPlan(makeTasks(2));

    approvePlan();

    expect(planStore.get().approvedByUser).toBe(true);
    expect(planActionAtom.get()).toBe('approve');
  });

  // ── rejectPlan ───────────────────────────────────────────

  it('rejectPlan resets store to initial state and fires reject action', () => {
    setPlan(makeTasks(2), 'Test');

    rejectPlan();

    const state = planStore.get();
    expect(state.isActive).toBe(false);
    expect(state.tasks).toHaveLength(0);
    expect(state.approvedByUser).toBe(false);
    expect(planActionAtom.get()).toBe('reject');
  });

  // ── modifyPlan ───────────────────────────────────────────

  it('modifyPlan fires modify action without changing store state', () => {
    setPlan(makeTasks(2), 'Plan');

    modifyPlan();

    // Store state unchanged
    expect(planStore.get().isActive).toBe(true);
    expect(planStore.get().tasks).toHaveLength(2);
    // Action fired
    expect(planActionAtom.get()).toBe('modify');
  });

  // ── clearPlanAction ──────────────────────────────────────

  it('clearPlanAction resets action atom to null', () => {
    planActionAtom.set('approve');
    clearPlanAction();
    expect(planActionAtom.get()).toBeNull();
  });

  // ── addTask ──────────────────────────────────────────────

  it('addTask appends a task and activates the plan', () => {
    addTask({ id: 'new-1', title: 'New task' });

    const state = planStore.get();
    expect(state.isActive).toBe(true);
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].status).toBe('not-started');
  });

  // ── updateTaskStatus ────────────────────────────────────

  it('updateTaskStatus changes task status', () => {
    setPlan(makeTasks(2));

    updateTaskStatus('task-0', 'completed');

    expect(planStore.get().tasks[0].status).toBe('completed');
    expect(planStore.get().tasks[1].status).toBe('not-started');
  });

  it('updateTaskStatus sets currentTaskId when in-progress', () => {
    setPlan(makeTasks(2));

    updateTaskStatus('task-1', 'in-progress');

    expect(planStore.get().currentTaskId).toBe('task-1');
  });

  // ── getNextPendingTask ──────────────────────────────────

  it('getNextPendingTask returns first not-started task', () => {
    setPlan([
      { id: '1', title: 'A', status: 'completed' },
      { id: '2', title: 'B', status: 'not-started' },
      { id: '3', title: 'C', status: 'not-started' },
    ]);

    const next = getNextPendingTask();
    expect(next?.id).toBe('2');
  });

  it('getNextPendingTask returns null when all completed', () => {
    setPlan(makeTasks(2, true));
    expect(getNextPendingTask()).toBeNull();
  });

  // ── advanceToNextTask ───────────────────────────────────

  it('advanceToNextTask completes current and starts next', () => {
    setPlan(makeTasks(3));
    updateTaskStatus('task-0', 'in-progress');

    const next = advanceToNextTask();

    expect(next?.id).toBe('task-1');
    expect(planStore.get().tasks[0].status).toBe('completed');
    expect(planStore.get().tasks[1].status).toBe('in-progress');
  });

  // ── Two-phase workflow integration ──────────────────────

  it('full two-phase workflow: set plan → approve → action fires', () => {
    // Phase 1: LLM sets the plan
    setPlan(
      [
        { id: '1', title: 'Create components', status: 'not-started' },
        { id: '2', title: 'Add styling', status: 'not-started' },
      ],
      'Counter App Plan',
    );

    expect(planStore.get().isActive).toBe(true);
    expect(planStore.get().approvedByUser).toBe(false);
    expect(planProgress.get()).toBe(0);

    // Phase 2: User approves
    approvePlan();

    expect(planStore.get().approvedByUser).toBe(true);
    expect(planActionAtom.get()).toBe('approve');

    // Consumer clears the action after sending the message
    clearPlanAction();
    expect(planActionAtom.get()).toBeNull();
  });

  it('full modify workflow: set plan → modify → edit → approve', () => {
    setPlan(makeTasks(2), 'Plan');

    // User clicks Modify
    modifyPlan();
    expect(planActionAtom.get()).toBe('modify');
    clearPlanAction();

    // User edits PLAN.md and usePlanSync re-calls setPlan
    setPlan(
      [
        { id: 'edited-1', title: 'Edited task 1', status: 'not-started' },
        { id: 'edited-2', title: 'Edited task 2', status: 'not-started' },
        { id: 'edited-3', title: 'New task 3', status: 'not-started' },
      ],
      'Updated Plan',
    );

    expect(planStore.get().tasks).toHaveLength(3);
    expect(planStore.get().planTitle).toBe('Updated Plan');

    // User approves the modified plan
    approvePlan();
    expect(planActionAtom.get()).toBe('approve');
  });
});
