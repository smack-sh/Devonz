/**
 * Preview Error Handler
 *
 * Handles preview errors with cooldown, deduplication, and intelligent filtering
 * to prevent the same error from triggering multiple alerts and to suppress
 * non-actionable errors that would only confuse users.
 *
 * Features:
 * - Error suppression for known non-actionable issues (source maps, 3D lib buffers)
 * - Severity classification (critical, warning, info)
 * - User-friendly error messages
 * - Cooldown and deduplication
 * - Auto-fix integration for code errors
 */

/* NOTE: workbenchStore is imported lazily inside showAlert() to avoid circular dependency */
import { cleanStackTrace } from '~/utils/stacktrace';
import { createScopedLogger } from '~/utils/logger';
import {
  shouldSuppressError,
  getUserFriendlyMessage,
  classifyErrorSeverity,
  SEVERITY_CONFIG,
} from '~/utils/errors/errorConfig';
import {
  autoFixStore,
  startAutoFix,
  shouldContinueFix,
  hasExceededMaxRetries,
  type ErrorSource,
} from '~/lib/stores/autofix';
import type { AutoFixCallback } from './terminalErrorDetector';

const logger = createScopedLogger('PreviewErrorHandler');

// Global auto-fix callback - shared with terminal error detector
let globalPreviewAutoFixCallback: AutoFixCallback | null = null;

/**
 * Register a callback to handle auto-fix requests from preview errors
 */
export function registerPreviewAutoFixCallback(callback: AutoFixCallback): void {
  globalPreviewAutoFixCallback = callback;
  logger.debug('Preview auto-fix callback registered');
}

/**
 * Unregister the preview auto-fix callback
 */
export function unregisterPreviewAutoFixCallback(): void {
  globalPreviewAutoFixCallback = null;
  logger.debug('Preview auto-fix callback unregistered');
}

/**
 * Simple hash function for error deduplication
 */
function hashError(error: string): string {
  let hash = 0;
  const cleanError = error.replace(/\d+/g, 'N').slice(0, 200); // Normalize numbers, limit length

  for (let i = 0; i < cleanError.length; i++) {
    const char = cleanError.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }

  return hash.toString(16);
}

/**
 * Preview Error Handler class
 * Handles cooldown and deduplication for preview errors
 */
class PreviewErrorHandler {
  #lastAlertTime: number = 0;
  #recentErrorHashes: Set<string> = new Set();
  #isEnabled: boolean = true;
  #cleanupIntervalId: ReturnType<typeof setInterval> | null = null;

  // Configuration constants
  #COOLDOWN_MS = 5000; // 5 seconds cooldown between alerts
  #HASH_TTL_MS = 60000; // Clear hashes after 1 minute

  constructor() {
    // Clean up old hashes periodically - store interval ID for cleanup
    this.#cleanupIntervalId = setInterval(() => this.#cleanupOldHashes(), this.#HASH_TTL_MS);
  }

  /**
   * Cleanup resources when handler is no longer needed
   * Call this method to prevent memory leaks
   */
  destroy(): void {
    if (this.#cleanupIntervalId) {
      clearInterval(this.#cleanupIntervalId);
      this.#cleanupIntervalId = null;
    }

    this.#recentErrorHashes.clear();
    logger.debug('PreviewErrorHandler destroyed');
  }

  /**
   * Enable/disable error handling
   */
  setEnabled(enabled: boolean): void {
    this.#isEnabled = enabled;
    logger.debug(`Preview error handling ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Handle a preview error message from the runtime
   */
  async handlePreviewMessage(message: {
    type: string;
    message?: string;
    stack?: string;
    pathname?: string;
    search?: string;
    hash?: string;
    port?: number;
  }): Promise<void> {
    if (!this.#isEnabled) {
      return;
    }

    // Handle both uncaught exceptions and unhandled promise rejections
    if (message.type !== 'PREVIEW_UNCAUGHT_EXCEPTION' && message.type !== 'PREVIEW_UNHANDLED_REJECTION') {
      return;
    }

    const now = Date.now();
    const errorMessage = message.message || 'Unknown error';
    const fullErrorContext = `${errorMessage} ${message.stack || ''}`;
    const isPromise = message.type === 'PREVIEW_UNHANDLED_REJECTION';

    // Check if error should be suppressed (non-actionable errors)
    if (shouldSuppressError(fullErrorContext, 'preview')) {
      logger.debug(`Suppressing non-actionable preview error: ${errorMessage.slice(0, 100)}`);

      return;
    }

    // Classify error severity
    const severity = classifyErrorSeverity(errorMessage, message.stack);

    // Only show alerts for critical and warning errors
    if (!SEVERITY_CONFIG[severity].showAlert) {
      logger.debug(`Skipping ${severity} severity preview error (no alert): ${errorMessage.slice(0, 100)}`);

      return;
    }

    // Generate error hash for deduplication
    const errorHash = hashError(errorMessage + (message.stack || ''));

    // Check cooldown
    if (now - this.#lastAlertTime < this.#COOLDOWN_MS) {
      logger.debug('Skipping preview alert due to cooldown');

      return;
    }

    // Check deduplication
    if (this.#recentErrorHashes.has(errorHash)) {
      logger.debug('Skipping duplicate preview error');

      return;
    }

    // Mark error as seen
    this.#recentErrorHashes.add(errorHash);
    this.#lastAlertTime = now;

    // Get user-friendly message if available
    const friendlyMessage = getUserFriendlyMessage(errorMessage);

    // Create title and description
    const title = friendlyMessage?.title || (isPromise ? 'Unhandled Promise Rejection' : 'Uncaught Exception');
    const description = friendlyMessage?.description || errorMessage;
    const suggestion = friendlyMessage?.suggestion || '';

    // Create content with helpful context
    const contentParts: string[] = [];
    contentParts.push(`Error occurred at ${message.pathname || '/'}${message.search || ''}${message.hash || ''}`);
    contentParts.push(`Port: ${message.port || 'unknown'}`);

    if (suggestion) {
      contentParts.push(`\n💡 Suggestion: ${suggestion}`);
    }

    contentParts.push(`\n\nStack trace:\n${cleanStackTrace(message.stack || '')}`);

    const content = contentParts.join('\n');

    /*
     * Check if we should trigger auto-fix instead of showing alert
     * Auto-fixable errors are typically code issues (SyntaxError, TypeError, ReferenceError, etc.)
     */
    const isAutoFixable = this.#isAutoFixableError(errorMessage);
    const canAutoFix = isAutoFixable && shouldContinueFix() && globalPreviewAutoFixCallback;

    if (canAutoFix) {
      // Trigger auto-fix instead of showing alert
      const started = startAutoFix({
        source: 'preview' as ErrorSource,
        type: severity,
        message: description,
        content,
      });

      if (started && globalPreviewAutoFixCallback) {
        logger.info(`Auto-fix triggered for preview error: ${title}`);

        // Add delay before triggering fix
        const autoFixState = autoFixStore.get();
        setTimeout(() => {
          globalPreviewAutoFixCallback?.({
            source: 'preview' as ErrorSource,
            type: severity,
            message: description,
            content,
          });
        }, autoFixState.settings.delayBetweenAttempts);

        return; // Don't show alert, auto-fix is handling it
      }
    }

    // If auto-fix didn't trigger, show max retries warning if applicable
    if (isAutoFixable && hasExceededMaxRetries()) {
      logger.warn('Max auto-fix retries exceeded for preview error, showing alert to user');
    }

    /* Lazy import to avoid circular dependency */
    const { workbenchStore } = await import('~/lib/stores/workbench');

    workbenchStore.actionAlert.set({
      type: 'preview',
      title,
      description,
      content,
      source: 'preview',
    });

    logger.info(`Preview error detected [${severity}]: ${title} - ${errorMessage.slice(0, 100)}`);
  }

  /**
   * Check if an error is auto-fixable (code issues that the LLM can fix)
   */
  #isAutoFixableError(errorMessage: string): boolean {
    const autoFixablePatterns = [
      /SyntaxError/i,
      /TypeError/i,
      /ReferenceError/i,
      /RangeError/i,
      /Cannot find module/i,
      /Module not found/i,
      /does not provide an export/i,
      /Failed to resolve import/i,
      /Unexpected token/i,
      /is not defined/i,
      /is not a function/i,
      /Cannot read propert/i,
      /Element type is invalid/i,
      /Objects are not valid as a React child/i,
      /Maximum update depth exceeded/i,
      /Invalid hook call/i,
      /must be used within/i,
      /Invariant Violation/i,
      /ChunkLoadError/i,
      /Failed to fetch dynamically imported module/i,
      /Cannot use import statement outside a module/i,
    ];

    return autoFixablePatterns.some((pattern) => pattern.test(errorMessage));
  }

  /**
   * Reset the handler state
   * Call this when user clicks "Ask Devonz" so the same error can be caught again
   */
  reset(): void {
    this.#recentErrorHashes.clear();
    this.#lastAlertTime = 0;
    logger.debug('Preview error handler reset');
  }

  #cleanupOldHashes(): void {
    // Simple cleanup - just clear if too many
    if (this.#recentErrorHashes.size > 50) {
      this.#recentErrorHashes.clear();
    }
  }
}

// Singleton instance
let handlerInstance: PreviewErrorHandler | null = null;

/**
 * Get the singleton preview error handler instance
 */
export function getPreviewErrorHandler(): PreviewErrorHandler {
  if (!handlerInstance) {
    handlerInstance = new PreviewErrorHandler();
  }

  return handlerInstance;
}

/**
 * Reset the preview error handler state
 * Call this when user requests a fix so the same error can be detected again
 */
export function resetPreviewErrorHandler(): void {
  getPreviewErrorHandler().reset();
}
