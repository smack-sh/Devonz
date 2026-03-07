import { useEffect, useState } from 'react';
import { useVersionCheck } from '~/lib/hooks/useVersionCheck';

/**
 * Non-intrusive banner that appears when a newer commit exists on main.
 * Shows update instructions for both Git Clone and Docker users,
 * an expandable changelog, and a slide-in entrance animation.
 */
export function UpdateBanner() {
  const { updateAvailable, relativeTime, commitsBehind, changelog, compareUrl, isDocker, error, dismiss } =
    useVersionCheck();

  const [visible, setVisible] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'updating' | 'success' | 'error'>('idle');
  const [updateMessage, setUpdateMessage] = useState('');

  const shouldRender = updateAvailable || (!!error && !updateAvailable);

  useEffect(() => {
    if (shouldRender) {
      // Allow one frame for the initial off-screen position before animating in
      const id = requestAnimationFrame(() => setVisible(true));

      return () => cancelAnimationFrame(id);
    }

    setVisible(false);

    return undefined;
  }, [shouldRender]);

  const handleUpdate = async () => {
    setUpdateStatus('updating');
    setUpdateMessage('');

    try {
      const res = await fetch('/api/update', { method: 'POST' });
      const data = await res.json();

      if (data.success) {
        setUpdateStatus('success');
        setUpdateMessage(data.message);
        setTimeout(() => window.location.reload(), 3000);
      } else {
        setUpdateStatus('error');
        setUpdateMessage(data.message);
      }
    } catch {
      setUpdateStatus('error');
      setUpdateMessage('Failed to connect to update server');
    }
  };

  if (!shouldRender) {
    return null;
  }

  /*
   * Error-only state: update check failed, nothing else to show.
   */
  if (error && !updateAvailable) {
    return (
      <div
        role="status"
        className="flex items-center gap-2 px-4 py-2 text-xs border-b transition-all duration-300"
        style={{
          backgroundColor: '#1a1a1a',
          borderColor: '#333333',
          transform: visible ? 'translateY(0)' : 'translateY(-100%)',
          opacity: visible ? 1 : 0,
        }}
      >
        <span className="i-ph:warning text-base" style={{ color: '#9ca3af' }} />
        <span style={{ color: '#9ca3af' }}>Unable to check for updates</span>
      </div>
    );
  }

  const displayedChangelog = changelog.slice(0, 10);

  return (
    <div
      role="status"
      className="border-b transition-all duration-300"
      style={{
        backgroundColor: '#141414',
        borderColor: '#333333',
        transform: visible ? 'translateY(0)' : 'translateY(-100%)',
        opacity: visible ? 1 : 0,
      }}
    >
      {/* ── Main bar ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2 text-xs">
        {/* Left: status info */}
        <div className="flex items-center gap-2 flex-wrap" style={{ color: '#ffffff' }}>
          <span className="i-ph:arrow-circle-up text-base" style={{ color: '#60a5fa' }} />
          <strong>Update available</strong>

          {commitsBehind > 0 && (
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold leading-none"
              style={{ backgroundColor: '#2a2a2a', color: '#60a5fa' }}
            >
              {commitsBehind} commit{commitsBehind === 1 ? '' : 's'} behind
            </span>
          )}

          {relativeTime && <span style={{ color: '#9ca3af' }}>{relativeTime}</span>}

          {displayedChangelog.length > 0 && (
            <button
              type="button"
              onClick={() => setShowChangelog((prev) => !prev)}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors"
              style={{ color: '#9ca3af', backgroundColor: showChangelog ? '#2a2a2a' : 'transparent' }}
              aria-label={showChangelog ? 'Hide changelog' : 'Show changelog'}
              aria-expanded={showChangelog}
            >
              <span
                className={`i-ph:caret-down text-xs transition-transform duration-200 ${showChangelog ? 'rotate-180' : ''}`}
              />
              <span className="text-[10px]">{showChangelog ? 'Hide' : 'Show'} changelog</span>
            </button>
          )}
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-3 flex-shrink-0">
          {!isDocker ? (
            <span className="flex items-center gap-2">
              {updateStatus === 'idle' && (
                <button
                  type="button"
                  onClick={handleUpdate}
                  className="inline-flex items-center gap-1 text-xs px-3 py-1 rounded-md transition-colors bg-[#3b82f6] hover:bg-[#2563eb] text-white"
                >
                  <span className="i-ph:arrow-circle-up text-sm" />
                  Update Now
                </button>
              )}
              {updateStatus === 'updating' && (
                <button
                  type="button"
                  disabled
                  className="inline-flex items-center gap-1 text-xs px-3 py-1 rounded-md"
                  style={{ backgroundColor: '#2a2a2a', color: '#9ca3af', cursor: 'not-allowed' }}
                >
                  <span className="i-svg-spinners:90-ring-with-bg text-sm" />
                  Updating…
                </button>
              )}
              {updateStatus === 'success' && (
                <span className="inline-flex items-center gap-1 text-xs" style={{ color: '#22c55e' }}>
                  <span className="i-ph:check-circle text-sm" />
                  Updated! Reloading…
                </span>
              )}
              {updateStatus === 'error' && (
                <span className="inline-flex items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1" style={{ color: '#ef4444' }}>
                    <span className="i-ph:warning text-sm" />
                    {updateMessage}
                  </span>
                  <button
                    type="button"
                    onClick={handleUpdate}
                    className="inline-flex items-center gap-1 text-xs px-3 py-1 rounded-md transition-colors bg-[#3b82f6] hover:bg-[#2563eb] text-white"
                  >
                    Retry
                  </button>
                </span>
              )}
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <code
                className="px-1.5 py-0.5 rounded text-[11px]"
                style={{ backgroundColor: '#2a2a2a', color: '#9ca3af' }}
              >
                docker compose pull &amp;&amp; docker compose up -d
              </code>
              <code
                className="px-1.5 py-0.5 rounded text-[11px]"
                style={{ backgroundColor: '#2a2a2a', color: '#9ca3af' }}
              >
                pnpm docker:update
              </code>
            </span>
          )}

          {compareUrl && (
            <a
              href={compareUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 transition-colors"
              style={{ color: '#9ca3af' }}
              aria-label="View changes on GitHub"
            >
              <span className="i-ph:github-logo text-sm" />
              <span className="text-[11px] hidden sm:inline">GitHub</span>
            </a>
          )}

          <button
            type="button"
            onClick={dismiss}
            className="transition-colors"
            style={{ color: '#9ca3af' }}
            aria-label="Dismiss update notification"
          >
            <span className="i-ph:x text-sm" />
          </button>
        </div>
      </div>

      {/* ── Expanded changelog panel ─────────────────────────── */}
      {showChangelog && displayedChangelog.length > 0 && (
        <ul className="px-4 pb-2 text-xs space-y-0" style={{ backgroundColor: '#0a0a0a' }} aria-label="Recent commits">
          {displayedChangelog.map((commit) => (
            <li
              key={commit.hash}
              className="flex items-baseline gap-2 py-1 border-t"
              style={{ borderColor: '#2a2a2a' }}
            >
              <code className="flex-shrink-0 text-[11px]" style={{ color: '#60a5fa', fontFamily: 'monospace' }}>
                {commit.hash.slice(0, 7)}
              </code>
              <span className="truncate" style={{ color: '#ffffff' }}>
                {commit.message}
              </span>
              {commit.date && (
                <span className="flex-shrink-0 ml-auto" style={{ color: '#9ca3af' }}>
                  {commit.date}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
