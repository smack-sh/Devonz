import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runPhasePipeline, buildPhaseEvent, getPhaseNames, type PhasePipelineOptions } from './phase-pipeline';

// ─── Mocks ──────────────────────────────────────────────────────────────────

// Mock the Vercel AI SDK streamText
vi.mock('ai', () => ({
  streamText: vi.fn(),
  convertToCoreMessages: vi.fn((msgs: unknown[]) => msgs),
}));

// Mock the model router
vi.mock('./model-router', () => ({
  resolveModelForOperation: vi.fn(
    (_opType: string, _config: unknown, defaultProvider: string, defaultModel: string) => ({
      provider: defaultProvider,
      model: defaultModel,
    }),
  ),
}));

// Mock the logger
vi.mock('~/utils/logger', () => ({
  createScopedLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

import { streamText as mockStreamText } from 'ai';
import { resolveModelForOperation } from './model-router';

// ─── Helpers ────────────────────────────────────────────────────────────────

function createMockModelInstance() {
  return { id: 'mock-model' };
}

function makeOptions(overrides?: Partial<PhasePipelineOptions>): PhasePipelineOptions {
  return {
    getModelInstance: vi.fn(() => createMockModelInstance()),
    modelRoutingConfig: undefined,
    defaultProvider: 'Anthropic',
    defaultModel: 'claude-sonnet-4-20250514',
    systemPrompt: 'You are a helpful assistant.',
    messages: [{ role: 'user', content: 'Build a todo app' }],
    maxTokens: 4096,
    ...overrides,
  };
}

/**
 * Creates a fake stream result whose textStream yields the given text.
 * This simulates the Vercel AI SDK streamText return value.
 */
function fakeStreamResult(text: string) {
  return {
    textStream: (async function* () {
      yield text;
    })(),
  };
}

/**
 * Configures mockStreamText to return the given texts in order.
 * Each call to streamText consumes the next entry.
 */
function setupStreamSequence(texts: string[]) {
  const fn = mockStreamText as ReturnType<typeof vi.fn>;
  fn.mockReset();

  for (const text of texts) {
    fn.mockResolvedValueOnce(fakeStreamResult(text));
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('phase-pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Test 1: Phase sequencing order ──────────────────────────────────────

  it('executes phases in order: plan → scaffold → implement → review', async () => {
    const callOrder: string[] = [];
    const fn = mockStreamText as ReturnType<typeof vi.fn>;
    fn.mockReset();

    // Each call pushes its phase name based on the system prompt content
    fn.mockImplementation(async (params: { system: string }) => {
      if (params.system.includes('phase="plan"')) {
        callOrder.push('plan');
      } else if (params.system.includes('phase="scaffold"')) {
        callOrder.push('scaffold');
      } else if (params.system.includes('phase="implement"')) {
        callOrder.push('implement');
      } else if (params.system.includes('phase="review"')) {
        callOrder.push('review');
      }

      // Review always passes so no retries happen
      const isReview = params.system.includes('phase="review"');

      return fakeStreamResult(isReview ? '__review_pass__' : 'phase output');
    });

    const result = await runPhasePipeline(makeOptions());

    expect(callOrder).toEqual(['plan', 'scaffold', 'implement', 'review']);
    expect(result.reviewPassed).toBe(true);
    expect(result.correctionRetries).toBe(0);
  });

  // ── Test 2: No retries when review passes immediately ──────────────────

  it('does not retry when review passes on first attempt', async () => {
    // 4 calls: plan, scaffold, implement, review (pass)
    setupStreamSequence([
      'step 1\nstep 2', // plan
      'scaffold output', // scaffold
      'implemented code', // implement
      '__review_pass__', // review — pass
    ]);

    const result = await runPhasePipeline(makeOptions());

    expect(result.correctionRetries).toBe(0);
    expect(result.reviewPassed).toBe(true);
    expect(result.output).toBe('implemented code');
    expect(mockStreamText).toHaveBeenCalledTimes(4);
  });

  // ── Test 3: One correction retry then pass ─────────────────────────────

  it('retries implement once when review finds errors, then passes', async () => {
    setupStreamSequence([
      'plan output', // plan
      'scaffold output', // scaffold
      'broken code', // implement attempt 1
      'Error: missing import', // review 1 — fail
      'fixed code', // implement attempt 2
      '__review_pass__', // review 2 — pass
    ]);

    const result = await runPhasePipeline(makeOptions());

    expect(result.correctionRetries).toBe(1);
    expect(result.reviewPassed).toBe(true);
    expect(result.output).toBe('fixed code');
    expect(mockStreamText).toHaveBeenCalledTimes(6);
  });

  // ── Test 4: Max 2 correction retries then stops ────────────────────────

  it('stops after 2 correction retries and returns best-effort output', async () => {
    setupStreamSequence([
      'plan output', // plan
      'scaffold output', // scaffold
      'broken v1', // implement attempt 1
      'Error: issue A', // review 1 — fail
      'broken v2', // implement attempt 2
      'Error: issue B', // review 2 — fail
      'broken v3', // implement attempt 3
      'Error: issue C', // review 3 — fail
    ]);

    const result = await runPhasePipeline(makeOptions());

    expect(result.correctionRetries).toBe(2);
    expect(result.reviewPassed).toBe(false);
    expect(result.output).toBe('broken v3');

    // 4 base phases + 2 retries × 2 (implement + review) = 8
    expect(mockStreamText).toHaveBeenCalledTimes(8);
  });

  // ── Test 5: Each phase uses resolveModelForOperation ───────────────────

  it('calls resolveModelForOperation with correct operation types per phase', async () => {
    setupStreamSequence(['plan', 'scaffold', 'implement', '__review_pass__']);

    await runPhasePipeline(makeOptions());

    const calls = (resolveModelForOperation as ReturnType<typeof vi.fn>).mock.calls;

    // 4 phases = 4 calls to resolveModelForOperation
    expect(calls.length).toBe(4);

    // Verify operation type mapping
    expect(calls[0][0]).toBe('planning'); // plan → planning
    expect(calls[1][0]).toBe('code_generation'); // scaffold → code_generation
    expect(calls[2][0]).toBe('code_generation'); // implement → code_generation
    expect(calls[3][0]).toBe('error_correction'); // review → error_correction
  });

  // ── Test 6: Opt-in flag gating (unit test of getPhaseNames/buildPhaseEvent) ──

  it('buildPhaseEvent produces correct SSE tokens and getPhaseNames returns all 5 phases', () => {
    const names = getPhaseNames();
    expect(names).toEqual(['blueprint', 'plan', 'scaffold', 'implement', 'review']);

    expect(buildPhaseEvent('blueprint')).toBe('__phase:blueprint');
    expect(buildPhaseEvent('plan')).toBe('__phase:plan');
    expect(buildPhaseEvent('scaffold')).toBe('__phase:scaffold');
    expect(buildPhaseEvent('implement')).toBe('__phase:implement');
    expect(buildPhaseEvent('review')).toBe('__phase:review');
  });

  // ── Test 7: Phase outputs recorded in result ───────────────────────────

  it('records per-phase outputs in the result object', async () => {
    setupStreamSequence(['my plan', 'my scaffold', 'my code', '__review_pass__']);

    const result = await runPhasePipeline(makeOptions());

    expect(result.phaseOutputs.plan).toBe('my plan');
    expect(result.phaseOutputs.scaffold).toBe('my scaffold');
    expect(result.phaseOutputs.implement).toBe('my code');
    expect(result.phaseOutputs.review).toBe('__review_pass__');
  });

  // ── Test 8: getModelInstance called with resolved provider/model ───────

  it('calls getModelInstance with the resolved provider and model for each phase', async () => {
    const getModelInstance = vi.fn(() => createMockModelInstance());

    setupStreamSequence(['plan', 'scaffold', 'implement', '__review_pass__']);

    await runPhasePipeline(makeOptions({ getModelInstance }));

    // 4 phases = 4 calls
    expect(getModelInstance).toHaveBeenCalledTimes(4);

    // All calls use the default provider/model since routing config is undefined
    for (const call of getModelInstance.mock.calls as unknown[][]) {
      expect(call[0]).toBe('Anthropic');
      expect(call[1]).toBe('claude-sonnet-4-20250514');
    }
  });
});
