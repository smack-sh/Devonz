import { describe, it, expect } from 'vitest';
import {
  resolveModelForOperation,
  isValidOperationType,
  OPERATION_TYPES,
  type ModelRoutingConfig,
} from './model-router';

describe('model-router', () => {
  const defaultProvider = 'Anthropic';
  const defaultModel = 'claude-3-5-sonnet-latest';

  describe('resolveModelForOperation', () => {
    it('returns default model for each operation type when config is empty', () => {
      for (const opType of OPERATION_TYPES) {
        const result = resolveModelForOperation(opType, {}, defaultProvider, defaultModel);
        expect(result).toEqual({ provider: defaultProvider, model: defaultModel });
      }
    });

    it('returns default model when config is undefined', () => {
      const result = resolveModelForOperation('code_generation', undefined, defaultProvider, defaultModel);
      expect(result).toEqual({ provider: defaultProvider, model: defaultModel });
    });

    it('returns default model when config is null', () => {
      const result = resolveModelForOperation('planning', null, defaultProvider, defaultModel);
      expect(result).toEqual({ provider: defaultProvider, model: defaultModel });
    });

    it('returns overridden model for a specific operation type', () => {
      const config: ModelRoutingConfig = {
        code_generation: { provider: 'OpenAI', model: 'gpt-4o' },
      };
      const result = resolveModelForOperation('code_generation', config, defaultProvider, defaultModel);
      expect(result).toEqual({ provider: 'OpenAI', model: 'gpt-4o' });
    });

    it('returns default for operations not overridden when other operations are', () => {
      const config: ModelRoutingConfig = {
        code_generation: { provider: 'OpenAI', model: 'gpt-4o' },
      };
      const result = resolveModelForOperation('planning', config, defaultProvider, defaultModel);
      expect(result).toEqual({ provider: defaultProvider, model: defaultModel });
    });

    it('returns default when override has empty provider', () => {
      const config: ModelRoutingConfig = {
        summarization: { provider: '', model: 'gpt-4o' },
      };
      const result = resolveModelForOperation('summarization', config, defaultProvider, defaultModel);
      expect(result).toEqual({ provider: defaultProvider, model: defaultModel });
    });

    it('returns default when override has empty model', () => {
      const config: ModelRoutingConfig = {
        error_correction: { provider: 'OpenAI', model: '' },
      };
      const result = resolveModelForOperation('error_correction', config, defaultProvider, defaultModel);
      expect(result).toEqual({ provider: defaultProvider, model: defaultModel });
    });

    it('returns default for unknown operation types', () => {
      const result = resolveModelForOperation('nonexistent_operation', {}, defaultProvider, defaultModel);
      expect(result).toEqual({ provider: defaultProvider, model: defaultModel });
    });

    it('returns default for empty string operation type', () => {
      const result = resolveModelForOperation('', {}, defaultProvider, defaultModel);
      expect(result).toEqual({ provider: defaultProvider, model: defaultModel });
    });

    it('routes all 5 operation types independently', () => {
      const config: ModelRoutingConfig = {
        code_generation: { provider: 'OpenAI', model: 'gpt-4o' },
        planning: { provider: 'Google', model: 'gemini-2.0-flash' },
        error_correction: { provider: 'Anthropic', model: 'claude-3-opus-20240229' },
        summarization: { provider: 'Deepseek', model: 'deepseek-chat' },
        general: { provider: 'Groq', model: 'llama-3.1-70b-versatile' },
      };

      expect(resolveModelForOperation('code_generation', config, defaultProvider, defaultModel)).toEqual({
        provider: 'OpenAI',
        model: 'gpt-4o',
      });
      expect(resolveModelForOperation('planning', config, defaultProvider, defaultModel)).toEqual({
        provider: 'Google',
        model: 'gemini-2.0-flash',
      });
      expect(resolveModelForOperation('error_correction', config, defaultProvider, defaultModel)).toEqual({
        provider: 'Anthropic',
        model: 'claude-3-opus-20240229',
      });
      expect(resolveModelForOperation('summarization', config, defaultProvider, defaultModel)).toEqual({
        provider: 'Deepseek',
        model: 'deepseek-chat',
      });
      expect(resolveModelForOperation('general', config, defaultProvider, defaultModel)).toEqual({
        provider: 'Groq',
        model: 'llama-3.1-70b-versatile',
      });
    });
  });

  describe('isValidOperationType', () => {
    it('returns true for all valid operation types', () => {
      for (const opType of OPERATION_TYPES) {
        expect(isValidOperationType(opType)).toBe(true);
      }
    });

    it('returns false for invalid operation types', () => {
      expect(isValidOperationType('invalid')).toBe(false);
      expect(isValidOperationType('')).toBe(false);
      expect(isValidOperationType('CODE_GENERATION')).toBe(false);
    });

    it('accepts blueprint as a valid operation type', () => {
      expect(isValidOperationType('blueprint')).toBe(true);
    });
  });

  describe('OPERATION_TYPES', () => {
    it('contains exactly 6 operation types', () => {
      expect(OPERATION_TYPES).toHaveLength(6);
    });

    it('contains the expected operation types', () => {
      expect(OPERATION_TYPES).toContain('code_generation');
      expect(OPERATION_TYPES).toContain('planning');
      expect(OPERATION_TYPES).toContain('error_correction');
      expect(OPERATION_TYPES).toContain('summarization');
      expect(OPERATION_TYPES).toContain('general');
      expect(OPERATION_TYPES).toContain('blueprint');
    });
  });
});
