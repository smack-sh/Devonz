/**
 * Blueprint Schema Types
 *
 * Zod schemas for the blueprint structured output produced by the
 * generateText-based blueprint generation pipeline. A blueprint represents
 * a project architecture document that includes file structure, dependencies,
 * implementation phases, and key technical decisions.
 *
 * These schemas serve dual purpose:
 *  1. Runtime validation of LLM structured output via .parse()/.safeParse()
 *  2. LLM generation hints via .describe() annotations on every field
 *
 * @module types/blueprint
 */

import { z } from 'zod';

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * File Entry Schema
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Zod schema for an individual file entry within the blueprint structure */
export const blueprintFileEntrySchema = z
  .object({
    path: z.string().min(1).describe('Relative file path from the project root (e.g., "src/components/Button.tsx")'),
    purpose: z.string().min(1).describe("Brief description of the file's role in the project architecture"),
  })
  .describe('A single file in the project structure with its path and purpose');

/** Type for an individual file entry inferred from Zod schema */
export type BlueprintFileEntry = z.infer<typeof blueprintFileEntrySchema>;

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * Dependency Schema
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Zod schema for a project dependency */
export const blueprintDependencySchema = z
  .object({
    name: z.string().min(1).describe('Package name as it appears in package.json (e.g., "react", "zod")'),
    version: z
      .string()
      .optional()
      .describe('Semver version constraint (e.g., "^18.2.0"). Omit if no specific version is required'),
    reason: z.string().min(1).describe('Why this dependency is needed for the project'),
    isDev: z
      .boolean()
      .default(false)
      .describe('Whether this is a devDependency (true) or a production dependency (false)'),
  })
  .describe('A project dependency with its name, optional version, reason for inclusion, and dev/prod classification');

/** Type for a project dependency inferred from Zod schema */
export type BlueprintDependency = z.infer<typeof blueprintDependencySchema>;

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * Implementation Phase Schema
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Zod schema for a single implementation phase/step */
export const blueprintPhaseSchema = z
  .object({
    order: z.number().int().positive().describe('Sequential order of this phase (1-based)'),
    title: z.string().min(1).describe('Short descriptive title for the implementation phase'),
    description: z.string().min(1).describe('Detailed description of what this phase accomplishes'),
    files: z.array(z.string().min(1)).min(1).describe('List of file paths created or modified during this phase'),
  })
  .describe('An ordered implementation phase with its title, description, and affected files');

/** Type for an implementation phase inferred from Zod schema */
export type BlueprintPhase = z.infer<typeof blueprintPhaseSchema>;

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * Technical Decision Schema
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Zod schema for a technical decision record */
export const blueprintTechnicalDecisionSchema = z
  .object({
    area: z.string().min(1).describe('Domain area of the decision (e.g., "State Management", "Routing", "Styling")'),
    decision: z.string().min(1).describe('The technical choice that was made (e.g., "Use Zustand for global state")'),
    rationale: z.string().min(1).describe('Reasoning behind the decision — why this choice over alternatives'),
  })
  .describe('A key technical decision with its domain area, chosen approach, and rationale');

/** Type for a technical decision inferred from Zod schema */
export type BlueprintTechnicalDecision = z.infer<typeof blueprintTechnicalDecisionSchema>;

/*
 * ═══════════════════════════════════════════════════════════════════════════
 * Blueprint Schema (top-level)
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Zod schema for the complete project blueprint produced by LLM structured output */
export const blueprintSchema = z
  .object({
    projectName: z.string().min(1).describe('Name of the project being generated'),
    structure: z
      .array(blueprintFileEntrySchema)
      .min(1)
      .describe('Complete list of files in the project with their paths and purposes'),
    dependencies: z
      .array(blueprintDependencySchema)
      .describe('All project dependencies (production and dev) with reasons for inclusion'),
    phases: z
      .array(blueprintPhaseSchema)
      .min(1)
      .describe('Ordered list of implementation phases — each phase builds on the previous'),
    technicalDecisions: z
      .array(blueprintTechnicalDecisionSchema)
      .min(1)
      .describe('Key technical decisions made during architecture design with rationale'),
  })
  .describe('A complete project architecture blueprint with structure, dependencies, phases, and technical decisions');

/** Full blueprint type inferred from Zod schema */
export type Blueprint = z.infer<typeof blueprintSchema>;
