/**
 * @module schemas
 * Shared Zod validation schemas for API routes.
 *
 * Centralizes request validation to ensure consistency across routes
 * and prevent silent failures from malformed requests.
 */

import { z } from 'zod';

/*
 * ---------------------------------------------------------------------------
 * LLM / Provider schemas
 * ---------------------------------------------------------------------------
 */

/** Shared schema for LLM provider objects sent from the client. */
export const providerSchema = z.object({
  name: z.string().min(1, 'Provider name is required'),
  staticModels: z.array(z.any()).optional(),
  getApiKeyLink: z.string().optional(),
  labelForGetApiKey: z.string().optional(),
  icon: z.string().optional(),
});

/*
 * ---------------------------------------------------------------------------
 * Runtime schemas
 * ---------------------------------------------------------------------------
 */

/** Valid project ID: alphanumeric, hyphens, underscores, 1-64 chars. */
export const projectIdSchema = z
  .string()
  .min(1, 'projectId is required')
  .max(64, 'projectId must be at most 64 characters')
  .regex(/^[\w-]+$/, 'projectId must be alphanumeric with hyphens/underscores');

/** Safe relative path (no traversal). */
export const safePathSchema = z
  .string()
  .min(1, 'path is required')
  .refine((p) => !p.includes('..') && !p.startsWith('/'), {
    message: 'Path traversal detected',
  });

/** Schema for POST /api/runtime/exec operations. */
export const execRequestSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('boot'),
    projectId: projectIdSchema,
  }),
  z.object({
    op: z.literal('exec'),
    projectId: projectIdSchema,
    command: z.string().min(1, 'command is required'),
    cwd: z.string().optional(),
    env: z.record(z.string()).optional(),
    timeout: z.number().int().positive().optional(),
  }),
  z.object({
    op: z.literal('teardown'),
    projectId: projectIdSchema,
  }),
  z.object({
    op: z.literal('allocatePort'),
    projectId: projectIdSchema,
  }),
]);

/** Schema for POST /api/runtime/fs operations. */
export const fsWriteRequestSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('writeFile').default('writeFile'),
    projectId: projectIdSchema,
    path: safePathSchema,
    content: z.string(),
    binary: z.boolean().optional(),
  }),
  z.object({
    op: z.literal('mkdir'),
    projectId: projectIdSchema,
    path: safePathSchema,
    recursive: z.boolean().optional(),
  }),
  z.object({
    op: z.literal('rm'),
    projectId: projectIdSchema,
    path: safePathSchema,
    recursive: z.boolean().optional(),
    force: z.boolean().optional(),
  }),
  z.object({
    op: z.literal('rename'),
    projectId: projectIdSchema,
    oldPath: safePathSchema,
    newPath: safePathSchema,
  }),
]);

/** Schema for POST /api/runtime/terminal operations. */
export const terminalRequestSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('spawn'),
    projectId: projectIdSchema,
    command: z.string().optional(),
    cols: z.number().int().positive().optional(),
    rows: z.number().int().positive().optional(),
    env: z.record(z.string()).optional(),
    cwd: z.string().optional(),
  }),
  z.object({
    op: z.literal('write'),
    sessionId: z.string().min(1, 'sessionId is required'),
    data: z.string(),
  }),
  z.object({
    op: z.literal('resize'),
    sessionId: z.string().min(1, 'sessionId is required'),
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
  }),
  z.object({
    op: z.literal('kill'),
    sessionId: z.string().min(1, 'sessionId is required'),
    signal: z.string().optional(),
  }),
  z.object({
    op: z.literal('list'),
    projectId: projectIdSchema,
  }),
]);

/** Schema for POST /api/runtime/search. */
export const searchRequestSchema = z.object({
  projectId: projectIdSchema,
  query: z.string().min(1, 'query is required'),
  includes: z.array(z.string()).optional(),
  excludes: z.array(z.string()).optional(),
  caseSensitive: z.boolean().optional(),
  isRegex: z.boolean().optional(),
  isWordMatch: z.boolean().optional(),
  resultLimit: z.number().int().positive().max(5000).optional(),
});

/** SHA string for git operations. */
const shaSchema = z.string().min(1, 'SHA is required');

/** Schema for POST /api/runtime/git operations. */
export const gitRequestSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('commit'),
    projectId: projectIdSchema,
    message: z.string().min(1, 'Commit message is required'),
  }),
  z.object({ op: z.literal('log'), projectId: projectIdSchema, maxCount: z.number().int().positive().optional() }),
  z.object({ op: z.literal('checkout'), projectId: projectIdSchema, sha: shaSchema }),
  z.object({ op: z.literal('checkout-main'), projectId: projectIdSchema }),
  z.object({ op: z.literal('diff'), projectId: projectIdSchema, sha: shaSchema }),
  z.object({ op: z.literal('commit-files'), projectId: projectIdSchema, sha: shaSchema }),
  z.object({ op: z.literal('commit-files-status'), projectId: projectIdSchema, sha: shaSchema }),
  z.object({
    op: z.literal('file-diff'),
    projectId: projectIdSchema,
    sha: shaSchema,
    file: z.string().min(1, 'File path is required'),
  }),
  z.object({ op: z.literal('commit-diff'), projectId: projectIdSchema, sha: shaSchema }),
  z.object({ op: z.literal('archive'), projectId: projectIdSchema, sha: shaSchema, type: z.string().optional() }),
]);

/*
 * ---------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------
 */

/**
 * Parse a Zod schema and return a standardized 400 error Response on failure.
 * Returns the validated data on success or a Response on failure.
 */
export function parseOrError<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  _loggerName?: string,
): { success: true; data: T } | { success: false; response: Response } {
  const result = schema.safeParse(data);

  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));

    return {
      success: false,
      response: new Response(
        JSON.stringify({
          error: 'Invalid request',
          details,
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    };
  }

  return { success: true, data: result.data };
}
