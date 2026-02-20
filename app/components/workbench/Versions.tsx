import { memo, useState } from 'react';
import { useStore } from '@nanostores/react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-toastify';
import { versionsStore, type ProjectVersion } from '~/lib/stores/versions';
import { workbenchStore } from '~/lib/stores/workbench';

interface VersionCardProps {
  version: ProjectVersion;
  onRestore: (id: string) => void;
  onRevert: (id: string) => void;
}

const VersionCard = memo(({ version, onRestore, onRevert }: VersionCardProps) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="flex gap-4 p-4 rounded-xl transition-colors"
      style={{
        background: isHovered ? 'var(--devonz-elements-bg-depth-4)' : 'transparent',
      }}
    >
      {/* Thumbnail placeholder */}
      <div
        className="w-32 h-20 rounded-lg flex-shrink-0 overflow-hidden"
        style={{
          background:
            'linear-gradient(135deg, var(--devonz-elements-bg-depth-3) 0%, var(--devonz-elements-bg-depth-1) 100%)',
          border: '1px solid rgba(255,255,255,0.1)',
        }}
      >
        {version.thumbnail ? (
          <img loading="lazy" src={version.thumbnail} alt="Version preview" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-devonz-elements-textTertiary">
            <div className="i-ph:image text-2xl" />
          </div>
        )}
      </div>

      {/* Version info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          {/* Version ID badge */}
          <span
            className="px-2 py-0.5 rounded text-xs font-mono"
            style={{
              background: 'var(--devonz-elements-button-secondary-background)',
              color: 'var(--devonz-elements-textSecondary)',
            }}
          >
            {version.id}
          </span>

          {/* Latest badge */}
          {version.isLatest && (
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

          {/* Actions - right aligned */}
          <div className="ml-auto flex items-center gap-2">
            {!version.isLatest && (
              <button
                onClick={() => onRestore(version.id)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs transition-colors"
                style={{
                  background: 'var(--devonz-elements-button-primary-background)',
                  color: 'var(--devonz-elements-button-primary-text)',
                }}
              >
                <div className="i-ph:arrow-counter-clockwise text-sm" />
                Restore
              </button>
            )}
            <button
              onClick={() => onRevert(version.id)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs transition-colors"
              style={{
                background: 'var(--devonz-elements-button-secondary-background)',
                color: 'var(--devonz-elements-textSecondary)',
              }}
            >
              <div className="i-ph:arrow-u-up-left text-sm" />
              Revert
            </button>
          </div>
        </div>

        {/* Title and description */}
        <h3 className="text-sm font-medium text-devonz-elements-textPrimary truncate mb-0.5">{version.title}</h3>
        <p className="text-xs text-devonz-elements-textTertiary line-clamp-2 mb-1">{version.description}</p>

        {/* Timestamp */}
        <div className="flex items-center gap-1 text-xs text-devonz-elements-textTertiary">
          <div className="i-ph:clock text-xs" />
          <span>Saved {versionsStore.formatRelativeTime(version.timestamp)}</span>
        </div>
      </div>
    </motion.div>
  );
});

export const Versions = memo(() => {
  // Subscribe to store changes for reactivity (used to trigger re-renders)
  useStore(versionsStore.versions);

  const [searchQuery, setSearchQuery] = useState('');

  const allVersions = versionsStore.getAllVersions();

  const filteredVersions = allVersions.filter(
    (v) =>
      v.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.id.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const handleRestore = (id: string) => {
    const version = versionsStore.restoreVersion(id);

    if (version) {
      // Apply the version's files to the workbench
      for (const [path, file] of Object.entries(version.files)) {
        if (file.type === 'file') {
          workbenchStore.files.setKey(path, {
            type: 'file',
            content: file.content,
            isBinary: false,
          });
        }
      }

      toast.success(`Restored to ${version.title}`);
    }
  };

  const handleRevert = (id: string) => {
    const version = versionsStore.getVersion(id);

    if (version && version.messageId) {
      // Trigger the rewind functionality with the messageId
      const searchParams = new URLSearchParams(window.location.search);
      searchParams.set('rewindTo', version.messageId);
      window.location.search = searchParams.toString();
    } else {
      toast.error('Cannot revert: No message ID associated with this version');
    }
  };

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--devonz-elements-bg-depth-1)' }}>
      {/* Header */}
      <div className="p-4 border-b border-devonz-elements-borderColor">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-devonz-elements-textPrimary">Versions</h2>
          <span className="text-sm text-devonz-elements-textTertiary">
            {filteredVersions.length} of {allVersions.length}
          </span>
        </div>
        <p className="text-sm text-devonz-elements-textTertiary mb-4">
          View and restore previous versions of your project.
        </p>

        {/* Search */}
        <div className="relative">
          <div className="i-ph:magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-devonz-elements-textTertiary" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search versions by description or ID..."
            className="w-full pl-9 pr-4 py-2 rounded-lg text-sm text-devonz-elements-textPrimary placeholder-devonz-elements-textTertiary outline-none"
            style={{
              background: 'var(--devonz-elements-button-secondary-background)',
              border: '1px solid var(--devonz-elements-borderColor)',
            }}
          />
        </div>
      </div>

      {/* Versions list */}
      <div className="flex-1 overflow-y-auto p-2">
        {filteredVersions.length > 0 ? (
          <AnimatePresence>
            {filteredVersions.map((version, index) => (
              <VersionCard
                key={version.id}
                version={{ ...version, isLatest: index === 0 }}
                onRestore={handleRestore}
                onRevert={handleRevert}
              />
            ))}
          </AnimatePresence>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <div className="i-ph:clock-clockwise text-4xl text-devonz-elements-textTertiary mb-4" />
            <h3 className="text-sm font-medium text-devonz-elements-textSecondary mb-1">No versions yet</h3>
            <p className="text-xs text-devonz-elements-textTertiary max-w-xs">
              Versions are automatically created when the AI makes changes to your project.
            </p>
          </div>
        )}
      </div>
    </div>
  );
});
