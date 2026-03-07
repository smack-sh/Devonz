import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('CommandRewriter');

export interface RewriteResult {
  command: string;
  wasRewritten: boolean;
  originalCommand?: string;
  reason?: string;
}

/**
 * Rewrites unsupported runtime commands to Node.js equivalents.
 *
 * When AI models generate commands using runtimes that may not be
 * available on the host (Python, Ruby, PHP, etc.), we transparently
 * rewrite them to the closest Node.js equivalent so the preview works.
 */
export function rewriteUnsupportedCommand(command: string): RewriteResult {
  const trimmed = command.trim();

  /*
   * python3 -m http.server [PORT] → npx --yes serve -l PORT
   * python -m http.server [PORT]  → npx --yes serve -l PORT
   */
  const pythonHttpServerMatch = trimmed.match(/^python3?\s+-m\s+http\.server(?:\s+(\d+))?$/);

  if (pythonHttpServerMatch) {
    const port = pythonHttpServerMatch[1] || '8000';
    const rewritten = `npx --yes serve -l ${port}`;
    logger.info(`Rewrote: "${trimmed}" → "${rewritten}"`);

    return {
      command: rewritten,
      wasRewritten: true,
      originalCommand: trimmed,
      reason: `Python runtime not detected. Replaced with Node.js serve on port ${port}.`,
    };
  }

  // python -m SimpleHTTPServer [PORT] (Python 2 legacy) → npx --yes serve -l PORT
  const simpleHttpMatch = trimmed.match(/^python\s+-m\s+SimpleHTTPServer(?:\s+(\d+))?$/);

  if (simpleHttpMatch) {
    const port = simpleHttpMatch[1] || '8000';
    const rewritten = `npx --yes serve -l ${port}`;
    logger.info(`Rewrote: "${trimmed}" → "${rewritten}"`);

    return {
      command: rewritten,
      wasRewritten: true,
      originalCommand: trimmed,
      reason: `Python 2 runtime not detected. Replaced with Node.js serve on port ${port}.`,
    };
  }

  // php -S localhost:PORT → npx --yes serve -l PORT
  const phpServerMatch = trimmed.match(/^php\s+-S\s+(?:localhost|0\.0\.0\.0|127\.0\.0\.1):(\d+)/);

  if (phpServerMatch) {
    const port = phpServerMatch[1];
    const rewritten = `npx --yes serve -l ${port}`;
    logger.info(`Rewrote: "${trimmed}" → "${rewritten}"`);

    return {
      command: rewritten,
      wasRewritten: true,
      originalCommand: trimmed,
      reason: `PHP runtime not detected. Replaced with Node.js serve on port ${port}.`,
    };
  }

  // ruby -run -e httpd . -p PORT → npx --yes serve -l PORT
  const rubyServerMatch = trimmed.match(/^ruby\s+-run\s+-e\s+httpd\s+.*-p\s+(\d+)/);

  if (rubyServerMatch) {
    const port = rubyServerMatch[1];
    const rewritten = `npx --yes serve -l ${port}`;
    logger.info(`Rewrote: "${trimmed}" → "${rewritten}"`);

    return {
      command: rewritten,
      wasRewritten: true,
      originalCommand: trimmed,
      reason: `Ruby runtime not detected. Replaced with Node.js serve on port ${port}.`,
    };
  }

  /*
   * Python script execution — smart detection:
   *   If the script name looks like a server (serve.py, server.py, app.py, etc.)
   *   we auto-rewrite to `npx --yes serve -l PORT`.
   *   Otherwise, show a clear error message.
   */
  const pythonScriptMatch = trimmed.match(/^python3?\s+([\w./-]+\.py)(?:\s+(.*))?$/);

  if (pythonScriptMatch) {
    const scriptName = pythonScriptMatch[1].toLowerCase();
    const args = pythonScriptMatch[2] || '';

    // Check if script name suggests an HTTP server
    const serverPatterns = ['serve.py', 'server.py', 'http_server.py', 'httpserver.py', 'web.py', 'webserver.py'];
    const isLikelyServer = serverPatterns.some(
      (pattern) => scriptName === pattern || scriptName.endsWith(`/${pattern}`),
    );

    if (isLikelyServer) {
      // Try to extract port from args: --port PORT, -p PORT, or bare PORT
      const portMatch = args.match(/(?:--port\s+|-p\s+)(\d+)/) || args.match(/^(\d+)$/);
      const port = portMatch ? portMatch[1] : '8000';
      const rewritten = `npx --yes serve -l ${port}`;
      logger.info(`Rewrote server script: "${trimmed}" → "${rewritten}"`);

      return {
        command: rewritten,
        wasRewritten: true,
        originalCommand: trimmed,
        reason: `Python runtime not detected. Detected "${scriptName}" as HTTP server — replaced with Node.js serve on port ${port}.`,
      };
    }

    // Non-server Python script — show error
    logger.warn(`Cannot run Python script: ${trimmed}`);

    return {
      command: `echo "Error: Python is not available. Cannot run: ${trimmed.replace(/"/g, '\\"')}"`,
      wasRewritten: true,
      originalCommand: trimmed,
      reason: 'Python runtime not detected. Python scripts cannot be executed.',
    };
  }

  // Generic unsupported runtime commands
  const genericUnsupported = trimmed.match(/^(python3?|ruby|perl|php)\s/);

  if (genericUnsupported) {
    const runtime = genericUnsupported[1];
    logger.warn(`Unsupported runtime "${runtime}": ${trimmed}`);

    return {
      command: `echo "Error: ${runtime} is not available. Cannot run: ${trimmed.replace(/"/g, '\\"')}"`,
      wasRewritten: true,
      originalCommand: trimmed,
      reason: `${runtime} runtime not detected.`,
    };
  }

  return { command, wasRewritten: false };
}
