import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '@nanostores/react';
import { runtime } from '~/lib/runtime';
import { classNames } from '~/utils/classNames';
import { toast } from 'react-toastify';
import { createScopedLogger } from '~/utils/logger';
import { useFileContent } from '~/lib/hooks/useFileContent';
import { workbenchStore } from '~/lib/stores/workbench';

const logger = createScopedLogger('ProjectMemory');

const PROJECT_MEMORY_PATH = '/home/project/PROJECT.md';
const RELATIVE_PATH = 'PROJECT.md';

const DEFAULT_TEMPLATE = `# Project Memory

This file contains persistent instructions for the AI. The AI will read this file at the start of every conversation and follow these rules.

## Project Information
- Project Name: 
- Description: 

## Coding Standards
- 

## Style Guidelines
- 

## Important Notes
- 
`;

export default function ProjectMemoryTab() {
  const fileContent = useFileContent(PROJECT_MEMORY_PATH);
  const files = useStore(workbenchStore.files);
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  useEffect(() => {
    if (typeof fileContent === 'string') {
      setContent(fileContent);
      setOriginalContent(fileContent);
    } else {
      setContent('');
      setOriginalContent('');
    }
  }, [fileContent]);

  // Track unsaved changes
  useEffect(() => {
    setHasUnsavedChanges(content !== originalContent);
  }, [content, originalContent]);

  const handleSave = useCallback(async () => {
    if (!content.trim()) {
      toast.warning('Cannot save empty content. Add some instructions first.');
      return;
    }

    setIsSaving(true);

    try {
      /* Write directly to runtime filesystem */
      const rt = await runtime;
      await rt.fs.writeFile(RELATIVE_PATH, content);

      // Update the files store to reflect the change
      workbenchStore.files.setKey(PROJECT_MEMORY_PATH, {
        type: 'file',
        content,
        isBinary: false,
      });

      setOriginalContent(content);
      setHasUnsavedChanges(false);
      toast.success('Project memory saved successfully!');
    } catch (error) {
      logger.error('Failed to save PROJECT.md:', error);
      toast.error('Failed to save project memory. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }, [content]);

  const handleCreateTemplate = useCallback(() => {
    setContent(DEFAULT_TEMPLATE);
  }, []);

  const handleReset = useCallback(() => {
    setContent(originalContent);
    setHasUnsavedChanges(false);
  }, [originalContent]);

  const fileExists = !!files[PROJECT_MEMORY_PATH];

  return (
    <div className="flex flex-col h-full">
      <motion.div
        className="flex flex-col gap-6 p-4"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        {/* Header Section */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-medium text-devonz-elements-textPrimary">Project Memory</h3>
              {fileExists ? (
                <span className="px-2 py-0.5 text-xs rounded-full bg-green-500/10 text-green-500 font-medium">
                  Active
                </span>
              ) : (
                <span className="px-2 py-0.5 text-xs rounded-full bg-gray-500/10 text-gray-500 font-medium">
                  Not Created
                </span>
              )}
            </div>
            {hasUnsavedChanges && <span className="text-xs text-orange-500 font-medium">Unsaved changes</span>}
          </div>
          <p className="text-sm text-devonz-elements-textSecondary">
            Create a PROJECT.md file to give the AI persistent instructions that apply to every conversation in this
            project. The AI will read this file automatically and follow your rules.
          </p>
        </div>

        {/* Info Card */}
        <div
          className={classNames(
            'p-4 rounded-lg',
            'bg-devonz-elements-background-depth-2',
            'border border-devonz-elements-borderColor',
          )}
        >
          <h4 className="text-sm font-medium text-devonz-elements-textPrimary mb-2 flex items-center gap-2">
            <div className="i-ph:lightbulb w-4 h-4 text-devonz-elements-item-contentAccent" />
            What can you put in Project Memory?
          </h4>
          <ul className="text-sm text-devonz-elements-textSecondary space-y-1 list-disc list-inside">
            <li>Coding standards and conventions (e.g., "Use TypeScript strict mode")</li>
            <li>Style guidelines (e.g., "All headings must be red")</li>
            <li>Project-specific rules (e.g., "Never modify the config.ts file")</li>
            <li>Architecture decisions (e.g., "Use functional components with hooks")</li>
            <li>File structure preferences</li>
          </ul>
        </div>

        {/* Editor Section */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-devonz-elements-textPrimary">PROJECT.md Content</label>
            {!content && !fileExists && (
              <button
                onClick={handleCreateTemplate}
                className={classNames(
                  'px-3 py-1.5 text-xs rounded-md',
                  'bg-devonz-elements-button-primary-background',
                  'text-devonz-elements-button-primary-text',
                  'hover:bg-devonz-elements-button-primary-backgroundHover',
                  'transition-colors duration-200',
                )}
              >
                Start with Template
              </button>
            )}
          </div>

          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            aria-label="Project instructions"
            placeholder="Enter your project instructions here... The AI will follow these rules in every conversation."
            className={classNames(
              'w-full h-64 p-3 rounded-lg resize-y',
              'bg-devonz-elements-background-depth-3',
              'border border-devonz-elements-borderColor',
              'text-devonz-elements-textPrimary',
              'placeholder-devonz-elements-textTertiary',
              'focus:outline-none focus:ring-2 focus:ring-devonz-elements-focus',
              'font-mono text-sm',
              'transition-colors duration-200',
            )}
          />

          {/* Action Buttons */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={isSaving || !hasUnsavedChanges}
              className={classNames(
                'px-4 py-2 rounded-lg text-sm font-medium',
                'bg-devonz-elements-button-primary-background',
                'text-devonz-elements-button-primary-text',
                'hover:bg-devonz-elements-button-primary-backgroundHover',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                'transition-all duration-200',
              )}
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>

            {hasUnsavedChanges && (
              <button
                onClick={handleReset}
                className={classNames(
                  'px-4 py-2 rounded-lg text-sm font-medium',
                  'bg-devonz-elements-background-depth-2',
                  'text-devonz-elements-textSecondary',
                  'hover:text-devonz-elements-textPrimary',
                  'border border-devonz-elements-borderColor',
                  'transition-all duration-200',
                )}
              >
                Discard Changes
              </button>
            )}
          </div>
        </div>

        {/* File Path Info */}
        <div className="text-xs text-devonz-elements-textTertiary">
          File location:{' '}
          <code className="px-1 py-0.5 rounded bg-devonz-elements-background-depth-2">{PROJECT_MEMORY_PATH}</code>
        </div>
      </motion.div>
    </div>
  );
}
