/**
 * Agent Tools Service
 *
 * This service provides the core tool implementations for Devonz AI Agent Mode.
 * Tools enable the AI to interact with the WebContainer filesystem and understand
 * the codebase context for autonomous coding capabilities.
 *
 * Tools follow the Vercel AI SDK format for seamless integration with the chat system.
 */

import { webcontainer } from '~/lib/webcontainer';
import { createScopedLogger } from '~/utils/logger';
import { autoFixStore } from '~/lib/stores/autofix';
import type {
  ToolExecutionResult,
  ReadFileParams,
  ReadFileResult,
  WriteFileParams,
  WriteFileResult,
  ListDirectoryParams,
  ListDirectoryResult,
  DirectoryEntry,
  RunCommandParams,
  RunCommandResult,
  GetErrorsParams,
  GetErrorsResult,
  ErrorInfo,
  SearchCodeParams,
  SearchCodeResult,
  SearchMatch,
  AgentToolDefinition,
} from '~/lib/agent/types';

const logger = createScopedLogger('AgentTools');

// Lazy import to avoid circular dependencies
let workbenchStoreModule: typeof import('~/lib/stores/workbench') | null = null;

async function getWorkbenchStore() {
  if (!workbenchStoreModule) {
    workbenchStoreModule = await import('~/lib/stores/workbench');
  }

  return workbenchStoreModule.workbenchStore;
}

/*
 * ============================================================================
 * Tool Implementations
 * ============================================================================
 */

/**
 * Read File Tool
 * Reads the contents of a file from the WebContainer filesystem.
 */
async function readFile(params: ReadFileParams): Promise<ToolExecutionResult<ReadFileResult>> {
  const { path, startLine, endLine } = params;

  try {
    const container = await webcontainer;
    const content = await container.fs.readFile(path, 'utf-8');
    const lines = content.split('\n');

    // Handle line range if specified
    let resultContent = content;
    let truncated = false;

    if (startLine !== undefined || endLine !== undefined) {
      const start = (startLine ?? 1) - 1; // Convert to 0-indexed
      const end = endLine ?? lines.length;
      resultContent = lines.slice(start, end).join('\n');
      truncated = start > 0 || end < lines.length;
    }

    logger.debug(`Read file: ${path}`, { lineCount: lines.length, truncated });

    return {
      success: true,
      data: {
        content: resultContent,
        path,
        lineCount: lines.length,
        truncated,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to read file: ${path}`, error);

    return {
      success: false,
      error: `Failed to read file '${path}': ${errorMessage}`,
    };
  }
}

/**
 * Write File Tool
 * Writes content to a file in the WebContainer filesystem.
 * Creates parent directories if they don't exist.
 */
async function writeFile(params: WriteFileParams): Promise<ToolExecutionResult<WriteFileResult>> {
  const { path, content } = params;

  try {
    const container = await webcontainer;

    // Check if file exists to determine if this is a create or update
    let fileExists = false;

    try {
      await container.fs.readFile(path, 'utf-8');
      fileExists = true;
    } catch {
      // File doesn't exist, will be created
    }

    // Ensure parent directory exists
    const parentDir = path.substring(0, path.lastIndexOf('/'));

    if (parentDir) {
      await container.fs.mkdir(parentDir, { recursive: true });
    }

    // Write the file
    await container.fs.writeFile(path, content, 'utf-8');

    logger.info(`Wrote file: ${path}`, {
      bytes: content.length,
      created: !fileExists,
    });

    return {
      success: true,
      data: {
        path,
        bytesWritten: content.length,
        created: !fileExists,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to write file: ${path}`, error);

    return {
      success: false,
      error: `Failed to write file '${path}': ${errorMessage}`,
    };
  }
}

/**
 * List Directory Tool
 * Lists files and subdirectories in a directory.
 * Supports recursive listing with filtering.
 */
async function listDirectory(params: ListDirectoryParams): Promise<ToolExecutionResult<ListDirectoryResult>> {
  const { path = '/', recursive = false, maxDepth = 3 } = params;

  try {
    const container = await webcontainer;
    const entries: DirectoryEntry[] = [];

    // Directories to skip during recursive traversal
    const skipDirs = ['node_modules', '.git', '.next', 'dist', 'build', '.cache'];

    async function traverse(dirPath: string, currentDepth: number): Promise<void> {
      const items = await container.fs.readdir(dirPath, { withFileTypes: true });

      for (const item of items) {
        const fullPath = dirPath === '/' ? `/${item.name}` : `${dirPath}/${item.name}`;
        const isDir = item.isDirectory();

        entries.push({
          name: fullPath,
          isDirectory: isDir,
        });

        // Recurse into subdirectories if enabled and within depth limit
        if (recursive && isDir && currentDepth < maxDepth) {
          // Skip common large/irrelevant directories
          if (!skipDirs.includes(item.name) && !item.name.startsWith('.')) {
            await traverse(fullPath, currentDepth + 1);
          }
        }
      }
    }

    await traverse(path, 0);

    logger.debug(`Listed directory: ${path}`, {
      entryCount: entries.length,
      recursive,
    });

    return {
      success: true,
      data: {
        path,
        entries,
        truncated: false,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to list directory: ${path}`, error);

    return {
      success: false,
      error: `Failed to list directory '${path}': ${errorMessage}`,
    };
  }
}

/**
 * Run Command Tool
 * Executes a shell command in the WebContainer using the DevonzShell.
 * Requires the terminal to be initialized and ready.
 */
async function runCommand(params: RunCommandParams): Promise<ToolExecutionResult<RunCommandResult>> {
  const { command, cwd, timeout = 30000 } = params;

  try {
    const workbench = await getWorkbenchStore();
    const shell = workbench.devonzTerminal;

    // Check if shell is ready
    await shell.ready();

    if (!shell.terminal || !shell.process) {
      return {
        success: false,
        error: 'Terminal is not initialized. The terminal must be attached to run commands.',
      };
    }

    // Build the command with optional cwd
    let fullCommand = command;

    if (cwd) {
      fullCommand = `cd ${cwd} && ${command}`;
    }

    logger.info(`Executing agent command: ${fullCommand}`);

    // Execute with a session ID unique to this agent call
    const sessionId = `agent-${Date.now()}`;

    // Create a timeout promise
    const timeoutPromise = new Promise<null>((_, reject) => {
      setTimeout(() => reject(new Error(`Command timed out after ${timeout}ms`)), timeout);
    });

    // Race between command execution and timeout
    const result = await Promise.race([shell.executeCommand(sessionId, fullCommand), timeoutPromise]);

    if (!result) {
      return {
        success: false,
        error: 'Command execution returned no result',
      };
    }

    const isSuccess = result.exitCode === 0;

    logger.debug(`Command completed with exit code ${result.exitCode}`, {
      outputLength: result.output?.length,
    });

    return {
      success: true,
      data: {
        exitCode: result.exitCode,
        stdout: isSuccess ? result.output : '',
        stderr: isSuccess ? '' : result.output,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to execute command: ${command}`, error);

    return {
      success: false,
      error: `Failed to execute command: ${errorMessage}`,
    };
  }
}

/**
 * Get Errors Tool
 * Retrieves current errors from the autofix store and preview error handler.
 */
async function getErrors(params: GetErrorsParams): Promise<ToolExecutionResult<GetErrorsResult>> {
  const { source } = params;

  try {
    const errors: ErrorInfo[] = [];

    // Get errors from autofix store
    const autoFixState = autoFixStore.get();

    if (autoFixState.currentError) {
      const err = autoFixState.currentError;

      // Filter by source if specified
      if (!source || err.source === source) {
        errors.push({
          source: err.source,
          type: err.type,
          message: err.message,
          file: undefined,
          line: undefined,
          column: undefined,
          content: err.content,
        });
      }
    }

    /*
     * Note: PreviewErrorHandler doesn't expose a getErrors() method.
     * Preview errors are captured via autoFixStore when they occur.
     */

    logger.debug(`Retrieved errors`, { count: errors.length, source });

    return {
      success: true,
      data: {
        errors,
        count: errors.length,
        hasErrors: errors.length > 0,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to get errors', error);

    return {
      success: false,
      error: `Failed to get errors: ${errorMessage}`,
    };
  }
}

/**
 * Search Code Tool
 * Searches for a text pattern across files in the WebContainer.
 */
async function searchCode(params: SearchCodeParams): Promise<ToolExecutionResult<SearchCodeResult>> {
  const { query, path = '/', maxResults = 50, includePattern, excludePattern, filePattern, caseSensitive = false } = params;

  try {
    const container = await webcontainer;
    const results: SearchMatch[] = [];
    let totalMatches = 0;

    // File extensions to search
    const codeExtensions = ['.ts', '.tsx', '.js', '.jsx', '.json', '.css', '.html', '.md', '.yaml', '.yml'];

    // Directories to skip
    const skipDirs = ['node_modules', '.git', '.next', 'dist', 'build', '.cache'];

    async function searchInDirectory(dirPath: string): Promise<void> {
      if (totalMatches >= maxResults) {
        return;
      }

      const items = await container.fs.readdir(dirPath, { withFileTypes: true });

      for (const item of items) {
        if (totalMatches >= maxResults) {
          break;
        }

        const fullPath = dirPath === '/' ? `/${item.name}` : `${dirPath}/${item.name}`;

        if (item.isDirectory()) {
          // Skip excluded directories
          if (!skipDirs.includes(item.name) && !item.name.startsWith('.')) {
            // Check exclude pattern
            if (excludePattern && new RegExp(excludePattern).test(fullPath)) {
              continue;
            }

            await searchInDirectory(fullPath);
          }
        } else {
          // Check if file should be searched
          const ext = item.name.substring(item.name.lastIndexOf('.'));

          // If filePattern is specified, only search files matching the pattern
          if (filePattern) {
            const matchesPattern = filePattern.split(',').some((p) => {
              const trimmed = p.trim();

              if (trimmed.startsWith('.')) {
                return ext === trimmed;
              }

              if (trimmed.startsWith('*')) {
                return item.name.endsWith(trimmed.slice(1));
              }

              return item.name === trimmed || item.name.endsWith(trimmed);
            });

            if (!matchesPattern) {
              continue;
            }
          } else if (!codeExtensions.includes(ext)) {
            continue;
          }

          // Check include/exclude patterns
          if (includePattern && !new RegExp(includePattern).test(fullPath)) {
            continue;
          }

          if (excludePattern && new RegExp(excludePattern).test(fullPath)) {
            continue;
          }

          // Search in file
          try {
            const content = await container.fs.readFile(fullPath, 'utf-8');
            const lines = content.split('\n');

            for (let i = 0; i < lines.length; i++) {
              if (totalMatches >= maxResults) {
                break;
              }

              // Try regex first, fall back to literal match
              let isMatch = false;

              try {
                isMatch = new RegExp(query, caseSensitive ? '' : 'i').test(lines[i]);
              } catch {
                // Invalid regex, fall back to literal match
                isMatch = caseSensitive ? lines[i].includes(query) : lines[i].toLowerCase().includes(query.toLowerCase());
              }

              if (isMatch) {
                // Calculate match positions
                let matchStart = 0;
                let matchEnd = 0;

                try {
                  const regexMatch = lines[i].match(new RegExp(query, caseSensitive ? '' : 'i'));

                  if (regexMatch && regexMatch.index !== undefined) {
                    matchStart = regexMatch.index;
                    matchEnd = regexMatch.index + regexMatch[0].length;
                  }
                } catch {
                  matchStart = lines[i].indexOf(query);
                  matchEnd = matchStart + query.length;
                }

                results.push({
                  file: fullPath,
                  line: i + 1,
                  content: lines[i].trim(),
                  matchStart,
                  matchEnd,
                });
                totalMatches++;
              }
            }
          } catch {
            // Skip files that can't be read
          }
        }
      }
    }

    await searchInDirectory(path);

    logger.debug(`Search completed for: ${query}`, { matchCount: results.length });

    return {
      success: true,
      data: {
        query,
        results,
        matchCount: results.length,
        truncated: totalMatches >= maxResults,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to search code for: ${query}`, error);

    return {
      success: false,
      error: `Failed to search code: ${errorMessage}`,
    };
  }
}

/**
 * Delete File Tool
 * Deletes a file or directory from the WebContainer filesystem.
 */
async function deleteFile(params: {
  path: string;
  recursive?: boolean;
}): Promise<ToolExecutionResult<{ path: string; deleted: boolean }>> {
  const { path, recursive = false } = params;

  try {
    const container = await webcontainer;

    // Check if path exists and what type it is
    try {
      const stat = await container.fs.readdir(path, { withFileTypes: true });

      // If readdir succeeds, it's a directory

      if (recursive) {
        await container.fs.rm(path, { recursive: true });
      } else {
        // Check if directory is empty
        if (stat.length > 0) {
          return {
            success: false,
            error: `Directory '${path}' is not empty. Use recursive: true to delete non-empty directories.`,
          };
        }

        await container.fs.rm(path);
      }
    } catch {
      // Not a directory, try to delete as file
      await container.fs.rm(path);
    }

    logger.info(`Deleted: ${path}`, { recursive });

    return {
      success: true,
      data: {
        path,
        deleted: true,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to delete: ${path}`, error);

    return {
      success: false,
      error: `Failed to delete '${path}': ${errorMessage}`,
    };
  }
}

/**
 * Rename/Move File Tool
 * Renames or moves a file in the WebContainer filesystem.
 */
async function renameFile(params: {
  oldPath: string;
  newPath: string;
}): Promise<ToolExecutionResult<{ oldPath: string; newPath: string; renamed: boolean }>> {
  const { oldPath, newPath } = params;

  try {
    const container = await webcontainer;

    // Read the source file
    const content = await container.fs.readFile(oldPath, 'utf-8');

    // Ensure parent directory of destination exists
    const parentDir = newPath.substring(0, newPath.lastIndexOf('/'));

    if (parentDir) {
      await container.fs.mkdir(parentDir, { recursive: true });
    }

    // Write to new location
    await container.fs.writeFile(newPath, content, 'utf-8');

    // Delete old file
    await container.fs.rm(oldPath);

    logger.info(`Renamed: ${oldPath} → ${newPath}`);

    return {
      success: true,
      data: {
        oldPath,
        newPath,
        renamed: true,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to rename: ${oldPath} → ${newPath}`, error);

    return {
      success: false,
      error: `Failed to rename '${oldPath}' to '${newPath}': ${errorMessage}`,
    };
  }
}

/**
 * Patch File Tool
 * Makes targeted text replacements in a file without rewriting the entire content.
 * More efficient than devonz_write_file for small changes.
 */
async function patchFile(params: {
  path: string;
  replacements: Array<{ oldText: string; newText: string }>;
}): Promise<ToolExecutionResult<{ path: string; replacementsApplied: number; totalReplacements: number }>> {
  const { path, replacements } = params;

  try {
    const container = await webcontainer;
    let content = await container.fs.readFile(path, 'utf-8');
    let applied = 0;

    for (const { oldText, newText } of replacements) {
      if (content.includes(oldText)) {
        content = content.replace(oldText, newText);
        applied++;
      }
    }

    if (applied === 0) {
      return {
        success: false,
        error: `No replacements matched in '${path}'. Verify the oldText strings are exact matches.`,
      };
    }

    await container.fs.writeFile(path, content, 'utf-8');

    logger.info(`Patched file: ${path}`, { applied, total: replacements.length });

    return {
      success: true,
      data: {
        path,
        replacementsApplied: applied,
        totalReplacements: replacements.length,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to patch file: ${path}`, error);

    return {
      success: false,
      error: `Failed to patch file '${path}': ${errorMessage}`,
    };
  }
}

/*
 * ============================================================================
 * Tool Definitions
 * ============================================================================
 */

/**
 * Agent tool definitions following Vercel AI SDK format.
 * Each tool has a name, description, parameters schema, and execute function.
 */
export const agentToolDefinitions: Record<string, AgentToolDefinition> = {
  devonz_read_file: {
    name: 'devonz_read_file',
    description:
      'Read the contents of a file from the project. Use this to examine existing code, configuration files, or any text file. Supports reading specific line ranges for large files.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The absolute path to the file to read (e.g., "/src/App.tsx")',
        },
        startLine: {
          type: 'number',
          description: 'Optional: Starting line number (1-indexed) for partial reads',
        },
        endLine: {
          type: 'number',
          description: 'Optional: Ending line number (inclusive) for partial reads',
        },
      },
      required: ['path'],
    },
    execute: readFile as unknown as (args: Record<string, unknown>) => Promise<ToolExecutionResult<unknown>>,
  },

  devonz_write_file: {
    name: 'devonz_write_file',
    description:
      'Write content to a file in the project. Creates the file if it does not exist, or overwrites if it does. Parent directories are created automatically. Use this to create new files or update existing ones.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The absolute path where the file should be written (e.g., "/src/components/Button.tsx")',
        },
        content: {
          type: 'string',
          description: 'The complete content to write to the file',
        },
      },
      required: ['path', 'content'],
    },
    execute: writeFile as unknown as (args: Record<string, unknown>) => Promise<ToolExecutionResult<unknown>>,
  },

  devonz_list_directory: {
    name: 'devonz_list_directory',
    description:
      'List all files and subdirectories in a directory. Use this to explore the project structure and find files. Supports recursive listing with configurable depth.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The absolute path to the directory to list (defaults to "/")',
        },
        recursive: {
          type: 'boolean',
          description: 'Whether to list contents recursively (default: false)',
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum depth for recursive listing (default: 3)',
        },
      },
      required: [],
    },
    execute: listDirectory,
  },

  devonz_run_command: {
    name: 'devonz_run_command',
    description:
      'Execute a shell command in the project environment. Use this to run build commands, install dependencies, run tests, or execute scripts. Note: Some commands may have limitations in the WebContainer environment.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute (e.g., "npm install", "npm run build")',
        },
        cwd: {
          type: 'string',
          description: 'Working directory for the command (defaults to project root)',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 30000, max: 120000)',
        },
      },
      required: ['command'],
    },
    execute: runCommand as unknown as (args: Record<string, unknown>) => Promise<ToolExecutionResult<unknown>>,
  },

  devonz_get_errors: {
    name: 'devonz_get_errors',
    description:
      'Get current errors from the development environment. This includes terminal errors, build errors, and runtime errors from the preview. Use this to understand what needs to be fixed.',
    parameters: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          enum: ['terminal', 'preview', 'build'],
          description: 'Filter errors by source (optional, returns all if not specified)',
        },
      },
      required: [],
    },
    execute: getErrors,
  },

  devonz_search_code: {
    name: 'devonz_search_code',
    description:
      'Search for a text pattern across files in the project. Use this to find where specific functions, variables, imports, or patterns are used. Searches common code file types by default.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The text pattern to search for',
        },
        path: {
          type: 'string',
          description: 'Directory path to search in (defaults to "/" for entire project)',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of results to return (default: 50)',
        },
        includePattern: {
          type: 'string',
          description: 'Regex pattern to include only matching file paths',
        },
        excludePattern: {
          type: 'string',
          description: 'Regex pattern to exclude matching file paths',
        },
        filePattern: {
          type: 'string',
          description:
            'Comma-separated file extensions or patterns to search (e.g., ".tsx,.ts" or "*.css"). Defaults to common code extensions.',
        },
        caseSensitive: {
          type: 'boolean',
          description: 'Whether the search is case-sensitive (default: false)',
        },
      },
      required: ['query'],
    },
    execute: searchCode as unknown as (args: Record<string, unknown>) => Promise<ToolExecutionResult<unknown>>,
  },

  devonz_delete_file: {
    name: 'devonz_delete_file',
    description:
      'Delete a file or directory from the project. Use this to remove files that are no longer needed. For non-empty directories, set recursive to true.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The absolute path to the file or directory to delete (e.g., "/src/old-component.tsx")',
        },
        recursive: {
          type: 'boolean',
          description: 'Whether to recursively delete directory contents (default: false)',
        },
      },
      required: ['path'],
    },
    execute: deleteFile as unknown as (args: Record<string, unknown>) => Promise<ToolExecutionResult<unknown>>,
  },

  devonz_rename_file: {
    name: 'devonz_rename_file',
    description:
      'Rename or move a file to a new location. Creates parent directories automatically. Use this instead of shell mv commands.',
    parameters: {
      type: 'object',
      properties: {
        oldPath: {
          type: 'string',
          description: 'The current absolute path of the file (e.g., "/src/OldName.tsx")',
        },
        newPath: {
          type: 'string',
          description: 'The new absolute path for the file (e.g., "/src/NewName.tsx")',
        },
      },
      required: ['oldPath', 'newPath'],
    },
    execute: renameFile as unknown as (args: Record<string, unknown>) => Promise<ToolExecutionResult<unknown>>,
  },

  devonz_patch_file: {
    name: 'devonz_patch_file',
    description:
      'Make targeted text replacements in a file without rewriting the entire content. More efficient than devonz_write_file for small changes. Each replacement finds the exact oldText and replaces it with newText.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The absolute path to the file to patch (e.g., "/src/App.tsx")',
        },
        replacements: {
          type: 'array',
          description: 'Array of {oldText, newText} objects. Each oldText must be an exact match in the file.',
          items: {
            type: 'object',
            properties: {
              oldText: {
                type: 'string',
                description: 'The exact text to find and replace',
              },
              newText: {
                type: 'string',
                description: 'The replacement text',
              },
            },
            required: ['oldText', 'newText'],
          },
        },
      },
      required: ['path', 'replacements'],
    },
    execute: patchFile as unknown as (args: Record<string, unknown>) => Promise<ToolExecutionResult<unknown>>,
  },
};

/*
 * ============================================================================
 * Public API
 * ============================================================================
 */

/**
 * Get all agent tools with execute functions.
 * Use this when registering tools with the AI SDK.
 */
export function getAgentTools(): Record<
  string,
  {
    description: string;
    parameters: AgentToolDefinition['parameters'];
    execute: (args: unknown) => Promise<ToolExecutionResult<unknown>>;
  }
> {
  const tools: Record<
    string,
    {
      description: string;
      parameters: AgentToolDefinition['parameters'];
      execute: (args: unknown) => Promise<ToolExecutionResult<unknown>>;
    }
  > = {};

  for (const [name, def] of Object.entries(agentToolDefinitions)) {
    tools[name] = {
      description: def.description,
      parameters: def.parameters,
      execute: def.execute as (args: unknown) => Promise<ToolExecutionResult<unknown>>,
    };
  }

  return tools;
}

/**
 * Get agent tools without execute functions.
 * Use this for serialization or sending to the client.
 */
export function getAgentToolsWithoutExecute(): Record<
  string,
  {
    description: string;
    parameters: AgentToolDefinition['parameters'];
  }
> {
  const tools: Record<
    string,
    {
      description: string;
      parameters: AgentToolDefinition['parameters'];
    }
  > = {};

  for (const [name, def] of Object.entries(agentToolDefinitions)) {
    tools[name] = {
      description: def.description,
      parameters: def.parameters,
    };
  }

  return tools;
}

/**
 * Execute a specific agent tool by name.
 * Use this for dynamic tool invocation.
 */
export async function executeAgentTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<ToolExecutionResult<unknown>> {
  const tool = agentToolDefinitions[toolName];

  if (!tool) {
    logger.error(`Unknown agent tool: ${toolName}`);

    return {
      success: false,
      error: `Unknown tool: ${toolName}`,
    };
  }

  logger.info(`Executing agent tool: ${toolName}`, { args });

  try {
    const result = await tool.execute(args as never);
    logger.debug(`Tool ${toolName} completed`, { success: result.success });

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Tool ${toolName} failed with exception`, error);

    return {
      success: false,
      error: `Tool execution failed: ${errorMessage}`,
    };
  }
}

/**
 * Get list of available agent tool names.
 */
export function getAgentToolNames(): string[] {
  return Object.keys(agentToolDefinitions);
}

/**
 * Check if a tool name is a valid agent tool.
 */
export function isAgentTool(toolName: string): boolean {
  return toolName in agentToolDefinitions;
}
