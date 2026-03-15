import { z } from 'zod';

/**
 * Shared types for the versioned programmatic API (/api/v1/).
 */

/*
 * ---------------------------------------------------------------------------
 * Request schemas
 * ---------------------------------------------------------------------------
 */

/** Zod schema for POST /api/v1/chat request body. */
export const v1ChatRequestSchema = z.object({
  model: z.string().min(1, 'model is required'),
  prompt: z.string().min(1, 'prompt is required'),
  context: z.string().optional(),
});

/** TypeScript type derived from the Zod schema. */
export type V1ChatRequest = z.infer<typeof v1ChatRequestSchema>;

/*
 * ---------------------------------------------------------------------------
 * Response types
 * ---------------------------------------------------------------------------
 */

/** Response shape for GET /api/v1/status. */
export interface V1StatusResponse {
  status: 'ok';
  version: string;
}

/** Error response shape returned by all v1 endpoints. */
export interface V1ErrorResponse {
  error: true;
  message: string;
  details?: Array<{ path: string; message: string }>;
}

/*
 * ---------------------------------------------------------------------------
 * SSE event helpers
 * ---------------------------------------------------------------------------
 */

/**
 * Format a string as an SSE `data:` frame, terminated by a double newline.
 * Multiple lines in `data` are each prefixed with `data:`.
 */
export function formatSSE(data: string, event?: string): string {
  let out = '';

  if (event) {
    out += `event: ${event}\n`;
  }

  for (const line of data.split('\n')) {
    out += `data: ${line}\n`;
  }

  out += '\n';

  return out;
}
