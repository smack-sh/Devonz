import { useState, useEffect, useCallback } from 'react';

const DISMISSED_HASH_KEY = 'update-dismissed-hash';

export interface VersionCheckResponse {
  local: { hash: string; fullHash: string };
  remote: { hash: string; fullHash: string; date: string; message: string };
  updateAvailable: boolean;
  commitsBehind: number;
  changelog: Array<{ hash: string; message: string; date: string }>;
  compareUrl: string;
  isDocker: boolean;
  error: string | null;
}

/**
 * Returns a human-readable relative time string (e.g. "2 hours ago").
 */
function relativeTimeFromDate(dateStr: string): string {
  if (!dateStr) {
    return '';
  }

  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);

  if (seconds < 0) {
    return 'just now';
  }

  const intervals: Array<[number, string]> = [
    [31_536_000, 'year'],
    [2_592_000, 'month'],
    [604_800, 'week'],
    [86_400, 'day'],
    [3_600, 'hour'],
    [60, 'minute'],
  ];

  for (const [value, unit] of intervals) {
    const count = Math.floor(seconds / value);

    if (count >= 1) {
      return `${count} ${unit}${count > 1 ? 's' : ''} ago`;
    }
  }

  return 'just now';
}

/**
 * Checks for updates against the GitHub repo on mount.
 * Re-checks every 30 minutes while the tab is active.
 *
 * Dismiss state is persisted per remote hash in localStorage so that a
 * dismissed banner reappears automatically when a newer commit lands.
 */
export function useVersionCheck() {
  const [data, setData] = useState<VersionCheckResponse | null>(null);

  const dismissedHash = typeof window !== 'undefined' ? localStorage.getItem(DISMISSED_HASH_KEY) : null;

  const isDismissed = Boolean(dismissedHash && data?.remote.hash && dismissedHash === data.remote.hash);

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch('/api/version-check');

        if (res.ok) {
          const json = (await res.json()) as VersionCheckResponse;
          setData(json);
        }
      } catch {
        // Network error — silently ignore
      }
    };

    // Initial check after 10s (don't block startup)
    const initial = setTimeout(check, 10_000);

    // Re-check every 30 minutes
    const interval = setInterval(check, 30 * 60 * 1000);

    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, []);

  const dismiss = useCallback(() => {
    if (data?.remote.hash) {
      localStorage.setItem(DISMISSED_HASH_KEY, data.remote.hash);

      /*
       * Force a re-render so `isDismissed` recalculates immediately.
       * We clone the data reference to trigger React state diff.
       */
      setData((prev) => (prev ? { ...prev } : prev));
    }
  }, [data?.remote.hash]);

  return {
    updateAvailable: Boolean(data?.updateAvailable) && !isDismissed,
    localHash: data?.local.hash ?? '',
    localFullHash: data?.local.fullHash ?? '',
    remoteHash: data?.remote.hash ?? '',
    remoteFullHash: data?.remote.fullHash ?? '',
    remoteMessage: data?.remote.message ?? '',
    remoteDate: data?.remote.date ?? '',
    relativeTime: relativeTimeFromDate(data?.remote.date ?? ''),
    commitsBehind: data?.commitsBehind ?? 0,
    changelog: data?.changelog ?? [],
    compareUrl: data?.compareUrl ?? '',
    isDocker: data?.isDocker ?? false,
    error: data?.error ?? null,
    dismiss,
  };
}
