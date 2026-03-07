/**
 * @module command-safety
 * Validates and audits commands before execution on the local runtime.
 *
 * Since the local runtime has full host access (unlike the sandboxed
 * WebContainer), this module provides a safety layer that:
 * - Blocks known-destructive command patterns
 * - Logs all executed commands for audit
 * - Provides configurable allow/deny lists
 */

import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('CommandSafety');

/**
 * Patterns that should NEVER be executed on the host.
 * Each entry has a regex and a human-readable reason.
 */
const BLOCKED_PATTERNS: { pattern: RegExp; reason: string }[] = [
  /*
   * Recursive force-delete of root or home.
   * Use non-capturing group instead of $ anchor so chained commands
   * (e.g. 'rm -rf / && echo') are also caught.
   */
  {
    pattern: /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?(-[a-zA-Z]*r[a-zA-Z]*\s+)?\s*\/(?:\s|[;&|]|$)/i,
    reason: 'Recursive delete of root directory',
  },
  {
    pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s+\/(?:\s|[;&|]|$)/i,
    reason: 'Recursive force-delete of root directory',
  },
  {
    pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*\s+~\/?(?:\s|[;&|]|$)/i,
    reason: 'Recursive delete of home directory',
  },
  {
    pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s+~\/?(?:\s|[;&|]|$)/i,
    reason: 'Recursive force-delete of home directory',
  },

  // Windows equivalents
  { pattern: /\bformat\s+[a-zA-Z]:/i, reason: 'Disk format command' },
  { pattern: /\brd\s+\/s\s+\/q\s+[a-zA-Z]:\\/i, reason: 'Recursive directory delete of drive root' },
  { pattern: /\bdel\s+\/[sf]\s+.*[a-zA-Z]:\\/i, reason: 'Recursive file delete from drive root' },

  // System-level destructive operations
  { pattern: /\bmkfs\b/i, reason: 'Filesystem format command' },
  { pattern: /\bdd\s+.*of=\/dev\//i, reason: 'Raw disk write via dd' },
  { pattern: /\b:>\s*\/etc\//i, reason: 'Truncating system config files' },
  { pattern: /\bchmod\s+-R\s+777\s+\//i, reason: 'Recursive chmod 777 on root' },
  { pattern: /\bchown\s+-R\s+.*\s+\//i, reason: 'Recursive chown on root' },

  // Fork bombs
  { pattern: /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;?\s*:/i, reason: 'Fork bomb' },
  { pattern: /\bwhile\s+true\s*;\s*do\s+fork/i, reason: 'Fork bomb variant' },

  // Reverse shells and network exfiltration
  { pattern: /\bbash\s+-i\s+>&?\s*\/dev\/tcp\//i, reason: 'Reverse shell via /dev/tcp' },
  { pattern: /\bnc\s+-[a-zA-Z]*e\s/i, reason: 'Netcat reverse shell' },
  { pattern: /\bpython[23]?\s+-c\s+.*socket.*connect/i, reason: 'Python reverse shell' },

  // Credential theft
  { pattern: /\bcurl\s+.*\|\s*sh\b/i, reason: 'Piping remote script to shell' },
  { pattern: /\bwget\s+.*\|\s*sh\b/i, reason: 'Piping remote script to shell' },
  { pattern: /\bcurl\s+.*\|\s*bash\b/i, reason: 'Piping remote script to bash' },
  { pattern: /\bwget\s+.*\|\s*bash\b/i, reason: 'Piping remote script to bash' },

  // Shutdown / reboot
  { pattern: /\bshutdown\b/i, reason: 'System shutdown command' },
  { pattern: /\breboot\b/i, reason: 'System reboot command' },
  { pattern: /\binit\s+[06]\b/i, reason: 'System halt/reboot via init' },

  // Explicit safety-override flags
  { pattern: /--no-preserve-root/i, reason: 'Bypassing rm root protection' },

  // Environment variable exfiltration
  {
    pattern: /\bcurl\b.*\$\{?\w*(?:KEY|TOKEN|SECRET|PASSWORD|PASS)\w*\}?/i,
    reason: 'Potential credential exfiltration via curl',
  },
  {
    pattern: /\bwget\b.*\$\{?\w*(?:KEY|TOKEN|SECRET|PASSWORD|PASS)\w*\}?/i,
    reason: 'Potential credential exfiltration via wget',
  },
];

export interface CommandValidationResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Validate a command before execution.
 * Returns `{ allowed: true }` if safe, or `{ allowed: false, reason }` if blocked.
 */
export function validateCommand(command: string): CommandValidationResult {
  const trimmed = command.trim();

  if (!trimmed) {
    return { allowed: true };
  }

  /*
   * Always check against blocked patterns first — even safe-prefix commands
   * can be chained with destructive operations (e.g., `npm install && rm -rf /`)
   */
  for (const { pattern, reason } of BLOCKED_PATTERNS) {
    if (pattern.test(trimmed)) {
      logger.warn(`BLOCKED command: "${trimmed}" — reason: ${reason}`);
      return { allowed: false, reason };
    }
  }

  return { allowed: true };
}

/**
 * Log a command execution for audit purposes.
 */
export function auditCommand(projectId: string, command: string, source: 'exec' | 'spawn' | 'terminal') {
  logger.info(`[AUDIT] [${source}] project=${projectId} cmd="${command}"`);
}

/** Default timeout for exec() calls: 5 minutes */
export const DEFAULT_EXEC_TIMEOUT_MS = 5 * 60 * 1000;

/** Default timeout for long-running spawn() processes: 30 minutes */
export const DEFAULT_SPAWN_TIMEOUT_MS = 30 * 60 * 1000;
