/**
 * Agent Tools Service Tests
 *
 * Unit tests for the Devonz AI Agent Mode tools.
 * Tests cover all 6 tool definitions and their execution logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  ReadFileResult,
  WriteFileResult,
  ListDirectoryResult,
  RunCommandResult,
  GetErrorsResult,
  SearchCodeResult,
} from '~/lib/agent/types';

// Mock functions need to be defined before vi.mock calls
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockMkdir = vi.fn();
const mockReaddir = vi.fn();
const mockRm = vi.fn();

// Mock shell functions for run_command
const mockExecuteCommand = vi.fn();
const mockShellReady = vi.fn();

// Mock the webcontainer module
vi.mock('~/lib/webcontainer', () => ({
  webcontainer: Promise.resolve({
    fs: {
      readFile: (...args: unknown[]) => mockReadFile(...args),
      writeFile: (...args: unknown[]) => mockWriteFile(...args),
      mkdir: (...args: unknown[]) => mockMkdir(...args),
      readdir: (...args: unknown[]) => mockReaddir(...args),
      rm: (...args: unknown[]) => mockRm(...args),
    },
  }),
}));

// Mock the workbench store for run_command
vi.mock('~/lib/stores/workbench', () => ({
  workbenchStore: {
    boltTerminal: {
      ready: () => mockShellReady(),
      terminal: { cols: 80, rows: 24 },
      process: {},
      executeCommand: (...args: unknown[]) => mockExecuteCommand(...args),
    },
  },
}));

// Mock the logger
vi.mock('~/utils/logger', () => ({
  createScopedLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock the autofix store
vi.mock('~/lib/stores/autofix', () => ({
  autoFixStore: {
    get: vi.fn(() => ({
      currentError: null,
    })),
  },
}));

// Mock the preview error handler
vi.mock('~/utils/previewErrorHandler', () => ({
  getPreviewErrorHandler: () => ({
    getErrors: () => [],
  }),
}));

// Import after mocks are set up
import {
  agentToolDefinitions,
  getAgentTools,
  getAgentToolsWithoutExecute,
  executeAgentTool,
  getAgentToolNames,
  isAgentTool,
} from './agentToolsService';

describe('agentToolDefinitions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('devonz_read_file', () => {
    const readFileTool = agentToolDefinitions.devonz_read_file;

    it('should have correct name and description', () => {
      expect(readFileTool.name).toBe('devonz_read_file');
      expect(readFileTool.description).toContain('Read the contents of a file');
    });

    it('should require path parameter', () => {
      expect(readFileTool.parameters.required).toContain('path');
    });

    it('should return file content on success', async () => {
      const mockContent = 'const hello = "world";';
      mockReadFile.mockResolvedValue(mockContent);

      const result = await readFileTool.execute({ path: '/src/test.ts' });

      expect(result.success).toBe(true);
      expect((result.data as ReadFileResult).content).toBe(mockContent);
      expect((result.data as ReadFileResult).lineCount).toBe(1);
    });

    it('should support line range reading', async () => {
      const mockContent = 'line1\nline2\nline3\nline4\nline5';
      mockReadFile.mockResolvedValue(mockContent);

      const result = await readFileTool.execute({
        path: '/src/test.ts',
        startLine: 2,
        endLine: 4,
      });

      expect(result.success).toBe(true);
      expect((result.data as ReadFileResult).content).toBe('line2\nline3\nline4');
      expect((result.data as ReadFileResult).truncated).toBe(true);
    });

    it('should return error for non-existent file', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT: no such file or directory'));

      const result = await readFileTool.execute({ path: '/nonexistent.txt' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to read file');
    });
  });

  describe('devonz_write_file', () => {
    const writeFileTool = agentToolDefinitions.devonz_write_file;

    it('should have correct name and description', () => {
      expect(writeFileTool.name).toBe('devonz_write_file');
      expect(writeFileTool.description).toContain('Write content to a file');
    });

    it('should require path and content parameters', () => {
      expect(writeFileTool.parameters.required).toContain('path');
      expect(writeFileTool.parameters.required).toContain('content');
    });

    it('should write file successfully', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT')); // File doesn't exist
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      const content = 'export const hello = "world";';
      const result = await writeFileTool.execute({
        path: '/src/new-file.ts',
        content,
      });

      expect(result.success).toBe(true);
      expect((result.data as WriteFileResult).path).toBe('/src/new-file.ts');
      expect((result.data as WriteFileResult).bytesWritten).toBe(content.length);
      expect((result.data as WriteFileResult).created).toBe(true);
    });

    it('should create parent directories', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      await writeFileTool.execute({
        path: '/deep/nested/path/file.ts',
        content: 'content',
      });

      expect(mockMkdir).toHaveBeenCalledWith('/deep/nested/path', { recursive: true });
    });

    it('should detect file update vs creation', async () => {
      mockReadFile.mockResolvedValue('existing content'); // File exists
      mockWriteFile.mockResolvedValue(undefined);

      const result = await writeFileTool.execute({
        path: '/src/existing.ts',
        content: 'new content',
      });

      expect(result.success).toBe(true);
      expect((result.data as WriteFileResult).created).toBe(false);
    });

    it('should return error on write failure', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockRejectedValue(new Error('EACCES: permission denied'));

      const result = await writeFileTool.execute({
        path: '/protected/file.ts',
        content: 'content',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to write file');
    });
  });

  describe('devonz_list_directory', () => {
    const listDirTool = agentToolDefinitions.devonz_list_directory;

    it('should have correct name and description', () => {
      expect(listDirTool.name).toBe('devonz_list_directory');
      expect(listDirTool.description).toContain('List all files and subdirectories');
    });

    it('should not require any parameters', () => {
      expect(listDirTool.parameters.required).toEqual([]);
    });

    it('should list directory contents', async () => {
      mockReaddir.mockResolvedValue([
        { name: 'src', isDirectory: () => true },
        { name: 'package.json', isDirectory: () => false },
        { name: 'README.md', isDirectory: () => false },
      ]);

      const result = await listDirTool.execute({ path: '/' });

      expect(result.success).toBe(true);
      expect((result.data as ListDirectoryResult).entries).toHaveLength(3);
      expect((result.data as ListDirectoryResult).entries[0]).toEqual({ name: '/src', isDirectory: true });
      expect((result.data as ListDirectoryResult).entries[1]).toEqual({ name: '/package.json', isDirectory: false });
    });

    it('should default to root path', async () => {
      mockReaddir.mockResolvedValue([]);

      const result = await listDirTool.execute({});

      expect(result.success).toBe(true);
      expect((result.data as ListDirectoryResult).path).toBe('/');
    });

    it('should support recursive listing', async () => {
      mockReaddir
        .mockResolvedValueOnce([{ name: 'src', isDirectory: () => true }])
        .mockResolvedValueOnce([
          { name: 'App.tsx', isDirectory: () => false },
          { name: 'components', isDirectory: () => true },
        ])
        .mockResolvedValueOnce([{ name: 'Button.tsx', isDirectory: () => false }]);

      const result = await listDirTool.execute({ path: '/', recursive: true });

      expect(result.success).toBe(true);
      expect((result.data as ListDirectoryResult).entries.length).toBeGreaterThan(1);
    });

    it('should skip node_modules and hidden directories', async () => {
      mockReaddir
        .mockResolvedValueOnce([
          { name: 'node_modules', isDirectory: () => true },
          { name: '.git', isDirectory: () => true },
          { name: 'src', isDirectory: () => true },
        ])
        .mockResolvedValueOnce([]); // src directory contents (empty)

      const result = await listDirTool.execute({ path: '/', recursive: true });

      expect(result.success).toBe(true);

      // Should only recurse into src, not node_modules or .git
      expect(mockReaddir).toHaveBeenCalledTimes(2); // root + src
    });

    it('should return error for non-existent directory', async () => {
      mockReaddir.mockRejectedValue(new Error('ENOENT: no such directory'));

      const result = await listDirTool.execute({ path: '/nonexistent' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to list directory');
    });
  });

  describe('devonz_run_command', () => {
    const runCommandTool = agentToolDefinitions.devonz_run_command;

    it('should have correct name and description', () => {
      expect(runCommandTool.name).toBe('devonz_run_command');
      expect(runCommandTool.description).toContain('Execute a shell command');
    });

    it('should require command parameter', () => {
      expect(runCommandTool.parameters.required).toContain('command');
    });

    it('should execute a command successfully', async () => {
      mockShellReady.mockResolvedValue(undefined);
      mockExecuteCommand.mockResolvedValue({
        exitCode: 0,
        output: 'Command output here',
      });

      const result = await runCommandTool.execute({ command: 'npm install' });

      expect(result.success).toBe(true);
      expect((result.data as RunCommandResult).exitCode).toBe(0);
      expect((result.data as RunCommandResult).stdout).toBe('Command output here');
    });

    it('should return error for failed command', async () => {
      mockShellReady.mockResolvedValue(undefined);
      mockExecuteCommand.mockResolvedValue({
        exitCode: 1,
        output: 'Error: module not found',
      });

      const result = await runCommandTool.execute({ command: 'npm run invalid' });

      expect(result.success).toBe(true); // Tool succeeded, command failed
      expect((result.data as RunCommandResult).exitCode).toBe(1);
      expect((result.data as RunCommandResult).stderr).toBe('Error: module not found');
    });

    it('should handle shell not ready', async () => {
      mockShellReady.mockRejectedValue(new Error('Shell not initialized'));

      const result = await runCommandTool.execute({ command: 'npm install' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to execute command');
    });
  });

  describe('devonz_get_errors', () => {
    const getErrorsTool = agentToolDefinitions.devonz_get_errors;

    it('should have correct name and description', () => {
      expect(getErrorsTool.name).toBe('devonz_get_errors');
      expect(getErrorsTool.description).toContain('Get current errors');
    });

    it('should not require any parameters', () => {
      expect(getErrorsTool.parameters.required).toEqual([]);
    });

    it('should return no errors when none exist', async () => {
      // Explicitly mock the store to return no error
      const { autoFixStore } = await import('~/lib/stores/autofix');
      vi.mocked(autoFixStore.get).mockReturnValue({
        currentError: null,
        settings: { isEnabled: true, maxRetries: 3, delayBetweenAttempts: 1000, showNotifications: true },
        currentRetries: 0,
        isFixing: false,
        fixHistory: [],
        sessionStartTime: null,
      });

      const result = await getErrorsTool.execute({});

      expect(result.success).toBe(true);
      expect((result.data as GetErrorsResult).hasErrors).toBe(false);
      expect((result.data as GetErrorsResult).count).toBe(0);
    });

    it('should return errors from autofix store when present', async () => {
      const { autoFixStore } = await import('~/lib/stores/autofix');
      vi.mocked(autoFixStore.get).mockReturnValue({
        currentError: {
          source: 'terminal',
          type: 'TypeError',
          message: 'Cannot read property x of undefined',
          content: 'Error details...',
        },
        settings: { isEnabled: true, maxRetries: 3, delayBetweenAttempts: 1000, showNotifications: true },
        currentRetries: 0,
        isFixing: false,
        fixHistory: [],
        sessionStartTime: null,
      });

      const result = await getErrorsTool.execute({ source: 'terminal' });

      expect(result.success).toBe(true);
      expect((result.data as GetErrorsResult).hasErrors).toBe(true);
      expect((result.data as GetErrorsResult).count).toBe(1);
    });
  });

  describe('devonz_search_code', () => {
    const searchCodeTool = agentToolDefinitions.devonz_search_code;

    it('should have correct name and description', () => {
      expect(searchCodeTool.name).toBe('devonz_search_code');
      expect(searchCodeTool.description).toContain('Search for a text pattern');
    });

    it('should require query parameter', () => {
      expect(searchCodeTool.parameters.required).toContain('query');
    });

    it('should find matching code', async () => {
      mockReaddir
        .mockResolvedValueOnce([{ name: 'src', isDirectory: () => true }])
        .mockResolvedValueOnce([{ name: 'App.tsx', isDirectory: () => false }]);
      mockReadFile.mockResolvedValue('import React from "react";\nconst App = () => <div>Hello</div>;');

      const result = await searchCodeTool.execute({ query: 'React' });

      expect(result.success).toBe(true);
      expect((result.data as SearchCodeResult).matchCount).toBeGreaterThan(0);
      expect((result.data as SearchCodeResult).results[0].file).toContain('App.tsx');
    });

    it('should respect maxResults limit', async () => {
      mockReaddir.mockResolvedValue([{ name: 'test.ts', isDirectory: () => false }]);
      mockReadFile.mockResolvedValue('match\nmatch\nmatch\nmatch\nmatch');

      const result = await searchCodeTool.execute({
        query: 'match',
        maxResults: 2,
      });

      expect(result.success).toBe(true);
      expect((result.data as SearchCodeResult).matchCount).toBe(2);
    });

    it('should return empty results for no matches', async () => {
      mockReaddir.mockResolvedValue([{ name: 'test.ts', isDirectory: () => false }]);
      mockReadFile.mockResolvedValue('no matches here');

      const result = await searchCodeTool.execute({ query: 'nonexistent' });

      expect(result.success).toBe(true);
      expect((result.data as SearchCodeResult).matchCount).toBe(0);
    });
  });
});

describe('getAgentTools', () => {
  it('should return all tools with execute functions', () => {
    const tools = getAgentTools();

    expect(Object.keys(tools)).toEqual(getAgentToolNames());

    for (const tool of Object.values(tools)) {
      expect(tool.description).toBeDefined();
      expect(tool.parameters).toBeDefined();
      expect(tool.execute).toBeInstanceOf(Function);
    }
  });
});

describe('getAgentToolsWithoutExecute', () => {
  it('should return all tools without execute functions', () => {
    const tools = getAgentToolsWithoutExecute();

    expect(Object.keys(tools)).toEqual(getAgentToolNames());

    for (const tool of Object.values(tools)) {
      expect(tool.description).toBeDefined();
      expect(tool.parameters).toBeDefined();
      expect((tool as unknown as { execute?: unknown }).execute).toBeUndefined();
    }
  });
});

describe('executeAgentTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should execute a valid tool', async () => {
    mockReadFile.mockResolvedValue('file content');

    const result = await executeAgentTool('devonz_read_file', { path: '/test.ts' });

    expect(result.success).toBe(true);
  });

  it('should return error for unknown tool', async () => {
    const result = await executeAgentTool('unknown_tool', {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown tool');
  });
});

describe('devonz_delete_file', () => {
  const deleteFileTool = agentToolDefinitions.devonz_delete_file;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should delete a file successfully', async () => {
    // readdir throws for files (not a directory)
    mockReaddir.mockRejectedValue(new Error('ENOTDIR'));
    mockRm.mockResolvedValue(undefined);

    const result = await deleteFileTool.execute({ path: '/src/old-file.ts' });

    expect(result.success).toBe(true);
    expect((result.data as { path: string; deleted: boolean }).path).toBe('/src/old-file.ts');
    expect((result.data as { path: string; deleted: boolean }).deleted).toBe(true);
    expect(mockRm).toHaveBeenCalledWith('/src/old-file.ts');
  });

  it('should delete an empty directory', async () => {
    // readdir succeeds with empty array (empty directory)
    mockReaddir.mockResolvedValue([]);
    mockRm.mockResolvedValue(undefined);

    const result = await deleteFileTool.execute({ path: '/src/empty-dir' });

    expect(result.success).toBe(true);
    expect((result.data as { path: string; deleted: boolean }).deleted).toBe(true);
    expect(mockRm).toHaveBeenCalledWith('/src/empty-dir');
  });

  it('should delete a non-empty directory with recursive=true', async () => {
    // readdir succeeds with items (non-empty directory)
    mockReaddir.mockResolvedValue([
      { name: 'file1.ts', isDirectory: () => false },
      { name: 'file2.ts', isDirectory: () => false },
    ]);
    mockRm.mockResolvedValue(undefined);

    const result = await deleteFileTool.execute({ path: '/src/components', recursive: true });

    expect(result.success).toBe(true);
    expect((result.data as { path: string; deleted: boolean }).deleted).toBe(true);
    expect(mockRm).toHaveBeenCalledWith('/src/components', { recursive: true });
  });

  it('should fail to delete non-empty directory without recursive flag', async () => {
    // readdir succeeds with items (non-empty directory)
    mockReaddir.mockResolvedValue([
      { name: 'file1.ts', isDirectory: () => false },
    ]);

    const result = await deleteFileTool.execute({ path: '/src/components' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not empty');
    expect(mockRm).not.toHaveBeenCalled();
  });

  it('should return error for non-existent file', async () => {
    // readdir throws (not a directory)
    mockReaddir.mockRejectedValue(new Error('ENOENT'));
    // rm also throws (file doesn't exist)
    mockRm.mockRejectedValue(new Error('ENOENT: no such file or directory'));

    const result = await deleteFileTool.execute({ path: '/nonexistent.txt' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to delete');
  });
});

describe('devonz_rename_file', () => {
  const renameFileTool = agentToolDefinitions.devonz_rename_file;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should rename a file successfully', async () => {
    const fileContent = 'export const Component = () => <div />;';
    mockReadFile.mockResolvedValue(fileContent);
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockRm.mockResolvedValue(undefined);

    const result = await renameFileTool.execute({ oldPath: '/src/OldName.tsx', newPath: '/src/NewName.tsx' });

    expect(result.success).toBe(true);
    expect((result.data as { oldPath: string; newPath: string; renamed: boolean }).oldPath).toBe('/src/OldName.tsx');
    expect((result.data as { oldPath: string; newPath: string; renamed: boolean }).newPath).toBe('/src/NewName.tsx');
    expect((result.data as { oldPath: string; newPath: string; renamed: boolean }).renamed).toBe(true);
    expect(mockReadFile).toHaveBeenCalledWith('/src/OldName.tsx', 'utf-8');
    expect(mockWriteFile).toHaveBeenCalledWith('/src/NewName.tsx', fileContent, 'utf-8');
    expect(mockRm).toHaveBeenCalledWith('/src/OldName.tsx');
  });

  it('should create parent directories for destination', async () => {
    mockReadFile.mockResolvedValue('content');
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockRm.mockResolvedValue(undefined);

    await renameFileTool.execute({ oldPath: '/src/file.ts', newPath: '/src/deep/nested/dir/file.ts' });

    expect(mockMkdir).toHaveBeenCalledWith('/src/deep/nested/dir', { recursive: true });
  });

  it('should return error when source does not exist', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT: no such file or directory'));

    const result = await renameFileTool.execute({ oldPath: '/nonexistent.ts', newPath: '/new.ts' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to rename');
  });
});

describe('getAgentToolNames', () => {
  it('should return all 9 tool names', () => {
    const names = getAgentToolNames();

    expect(names).toHaveLength(9);
    expect(names).toContain('devonz_read_file');
    expect(names).toContain('devonz_write_file');
    expect(names).toContain('devonz_list_directory');
    expect(names).toContain('devonz_run_command');
    expect(names).toContain('devonz_get_errors');
    expect(names).toContain('devonz_search_code');
    expect(names).toContain('devonz_delete_file');
    expect(names).toContain('devonz_rename_file');
    expect(names).toContain('devonz_patch_file');
  });
});

describe('isAgentTool', () => {
  it('should return true for valid agent tools', () => {
    expect(isAgentTool('devonz_read_file')).toBe(true);
    expect(isAgentTool('devonz_write_file')).toBe(true);
  });

  it('should return false for non-agent tools', () => {
    expect(isAgentTool('unknown_tool')).toBe(false);
    expect(isAgentTool('mcp_something')).toBe(false);
  });
});
