import { memo, useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-toastify';
import { runtimeContext } from '~/lib/runtime';
import { type GitCommitInfo, getLog, checkout, checkoutMain, getCommitFiles } from '~/lib/runtime/git-client';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('Versions');

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) {
    return 'Just now';
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  if (hours < 24) {
    return `${hours}h ago`;
  }

  return `${days}d ago`;
}

interface CommitCardProps {
  commit: GitCommitInfo;
  isLatest: boolean;
  isCheckedOut: boolean;
  onRestore: (sha: string) => void;
  onViewFiles: (sha: string) => void;
}

const CommitCard = memo(({ commit, isLatest, isCheckedOut, onRestore, onViewFiles }: CommitCardProps) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="flex gap-3 p-3 rounded-xl transition-colors"
      style={{
        background: isCheckedOut
          ? 'var(--devonz-elements-button-primary-background)'
          : isHovered
            ? 'var(--devonz-elements-bg-depth-4)'
            : 'transparent',
        opacity: isCheckedOut ? 0.95 : 1,
      }}
    >
      {/* Git commit icon */}
      <div className="flex-shrink-0 pt-0.5">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center"
          style={{
            background: isLatest
              ? 'var(--devonz-elements-button-primary-background)'
              : 'var(--devonz-elements-button-secondary-background)',
          }}
        >
          <div
            className="i-ph:git-commit text-sm"
            style={{
              color: isLatest ? 'var(--devonz-elements-button-primary-text)' : 'var(--devonz-elements-textSecondary)',
            }}
          />
        </div>
      </div>

      {/* Commit info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span
            className="px-1.5 py-0.5 rounded text-xs font-mono"
            style={{
              background: 'var(--devonz-elements-button-secondary-background)',
              color: 'var(--devonz-elements-textSecondary)',
            }}
          >
            {commit.shortSha}
          </span>

          {isLatest && (
            <span
              className="px-2 py-0.5 rounded text-xs font-medium"
              style={{
                background: 'var(--devonz-elements-button-primary-background)',
                color: 'var(--devonz-elements-button-primary-text)',
              }}
            >
              Latest
            </span>
          )}

          {isCheckedOut && !isLatest && (
            <span
              className="px-2 py-0.5 rounded text-xs font-medium"
              style={{
                background: 'var(--devonz-elements-item-backgroundAccent)',
                color: 'var(--devonz-elements-item-contentAccent)',
              }}
            >
              Active
            </span>
          )}

          {/* Actions */}
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => onViewFiles(commit.sha)}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors"
              style={{
                background: 'var(--devonz-elements-button-secondary-background)',
                color: 'var(--devonz-elements-textSecondary)',
              }}
              title="View changed files"
            >
              <div className="i-ph:files text-xs" />
            </button>
            {!isLatest && (
              <button
                onClick={() => onRestore(commit.sha)}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors"
                style={{
                  background: 'var(--devonz-elements-button-primary-background)',
                  color: 'var(--devonz-elements-button-primary-text)',
                }}
              >
                <div className="i-ph:arrow-counter-clockwise text-xs" />
                Restore
              </button>
            )}
          </div>
        </div>

        <h3 className="text-sm font-medium text-devonz-elements-textPrimary truncate mb-0.5">{commit.message}</h3>

        <div className="flex items-center gap-1 text-xs text-devonz-elements-textTertiary">
          <div className="i-ph:clock text-xs" />
          <span>{formatRelativeTime(commit.timestamp)}</span>
        </div>
      </div>
    </motion.div>
  );
});

export const Versions = memo(() => {
  const [commits, setCommits] = useState<GitCommitInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [checkedOutSha, setCheckedOutSha] = useState<string | null>(null);
  const [changedFiles, setChangedFiles] = useState<{ sha: string; files: string[] } | null>(null);
  const [restoring, setRestoring] = useState(false);

  const projectId = runtimeContext.projectId;

  const loadCommits = useCallback(async () => {
    if (!projectId) {
      setLoading(false);
      return;
    }

    setLoading(true);

    const log = await getLog(projectId);
    setCommits(log);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    loadCommits();
  }, [loadCommits]);

  const handleRestore = useCallback(
    async (sha: string) => {
      if (!projectId || restoring) {
        return;
      }

      setRestoring(true);

      try {
        const success = await checkout(projectId, sha);

        if (success) {
          setCheckedOutSha(sha);
          toast.success('Restored to previous version. Files will update shortly.');

          /*
           * The file watcher will pick up changes from git checkout,
           * but give it a moment then force a reload of the commit list.
           */
          setTimeout(() => loadCommits(), 1000);
        } else {
          toast.error('Failed to restore version');
        }
      } catch (error) {
        logger.error('Restore failed:', error);
        toast.error('Failed to restore version');
      } finally {
        setRestoring(false);
      }
    },
    [projectId, restoring, loadCommits],
  );

  const handleReturnToLatest = useCallback(async () => {
    if (!projectId || restoring) {
      return;
    }

    setRestoring(true);

    try {
      const success = await checkoutMain(projectId);

      if (success) {
        setCheckedOutSha(null);
        toast.success('Returned to latest version');
        setTimeout(() => loadCommits(), 1000);
      } else {
        toast.error('Failed to return to latest');
      }
    } catch (error) {
      logger.error('Return to latest failed:', error);
      toast.error('Failed to return to latest');
    } finally {
      setRestoring(false);
    }
  }, [projectId, restoring, loadCommits]);

  const handleViewFiles = useCallback(
    async (sha: string) => {
      if (!projectId) {
        return;
      }

      if (changedFiles?.sha === sha) {
        setChangedFiles(null);
        return;
      }

      const files = await getCommitFiles(projectId, sha);
      setChangedFiles({ sha, files });
    },
    [projectId, changedFiles],
  );

  const filteredCommits = commits.filter(
    (c) =>
      c.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.shortSha.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--devonz-elements-bg-depth-1)' }}>
      {/* Header */}
      <div className="p-4 border-b border-devonz-elements-borderColor">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="i-ph:git-branch text-lg text-devonz-elements-textSecondary" />
            <h2 className="text-lg font-semibold text-devonz-elements-textPrimary">Git History</h2>
          </div>
          <div className="flex items-center gap-2">
            {checkedOutSha && (
              <button
                onClick={handleReturnToLatest}
                disabled={restoring}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs transition-colors"
                style={{
                  background: 'var(--devonz-elements-button-primary-background)',
                  color: 'var(--devonz-elements-button-primary-text)',
                }}
              >
                <div className="i-ph:arrow-up text-xs" />
                Return to Latest
              </button>
            )}
            <button
              onClick={loadCommits}
              disabled={loading}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors"
              style={{
                background: 'var(--devonz-elements-button-secondary-background)',
                color: 'var(--devonz-elements-textSecondary)',
              }}
              title="Refresh"
            >
              <div className={`i-ph:arrow-clockwise text-sm ${loading ? 'animate-spin' : ''}`} />
            </button>
            <span className="text-sm text-devonz-elements-textTertiary">{commits.length} commits</span>
          </div>
        </div>

        <p className="text-xs text-devonz-elements-textTertiary mb-3">
          Every AI response is automatically committed. Restore any previous version with one click.
        </p>

        {/* Search */}
        <div className="relative">
          <div className="i-ph:magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-devonz-elements-textTertiary" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search commits..."
            className="w-full pl-9 pr-4 py-2 rounded-lg text-sm text-devonz-elements-textPrimary placeholder-devonz-elements-textTertiary outline-none"
            style={{
              background: 'var(--devonz-elements-button-secondary-background)',
              border: '1px solid var(--devonz-elements-borderColor)',
            }}
          />
        </div>
      </div>

      {/* Commits list */}
      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full">
            <div className="i-ph:spinner-gap-bold animate-spin text-2xl text-devonz-elements-textTertiary mb-2" />
            <span className="text-sm text-devonz-elements-textTertiary">Loading history...</span>
          </div>
        ) : filteredCommits.length > 0 ? (
          <AnimatePresence>
            {filteredCommits.map((commit, index) => (
              <div key={commit.sha}>
                <CommitCard
                  commit={commit}
                  isLatest={index === 0}
                  isCheckedOut={checkedOutSha === commit.sha}
                  onRestore={handleRestore}
                  onViewFiles={handleViewFiles}
                />
                {/* Changed files dropdown */}
                {changedFiles?.sha === commit.sha && changedFiles.files.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="ml-11 mb-2 px-3 py-2 rounded-lg text-xs"
                    style={{
                      background: 'var(--devonz-elements-bg-depth-3)',
                      border: '1px solid var(--devonz-elements-borderColor)',
                    }}
                  >
                    <div className="font-medium text-devonz-elements-textSecondary mb-1">
                      {changedFiles.files.length} file{changedFiles.files.length !== 1 ? 's' : ''} changed
                    </div>
                    {changedFiles.files.map((file) => (
                      <div
                        key={file}
                        className="flex items-center gap-1.5 py-0.5 text-devonz-elements-textTertiary font-mono"
                      >
                        <div className="i-ph:file-text text-xs" />
                        {file}
                      </div>
                    ))}
                  </motion.div>
                )}
              </div>
            ))}
          </AnimatePresence>
        ) : commits.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <div className="i-ph:git-commit text-4xl text-devonz-elements-textTertiary mb-4" />
            <h3 className="text-sm font-medium text-devonz-elements-textSecondary mb-1">No commits yet</h3>
            <p className="text-xs text-devonz-elements-textTertiary max-w-xs">
              Commits are created automatically after each AI response. Start a conversation to see history here.
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <div className="i-ph:magnifying-glass text-4xl text-devonz-elements-textTertiary mb-4" />
            <h3 className="text-sm font-medium text-devonz-elements-textSecondary mb-1">No matches</h3>
            <p className="text-xs text-devonz-elements-textTertiary">No commits match "{searchQuery}"</p>
          </div>
        )}
      </div>
    </div>
  );
});
