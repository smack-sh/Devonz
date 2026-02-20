import { atom, map } from 'nanostores';
import { createScopedLogger } from '~/utils/logger';
import { saveVersions as saveVersionsToDB, getVersionsByChatId } from '~/lib/persistence/db';

const logger = createScopedLogger('VersionsStore');

export interface ProjectVersion {
  id: string;
  messageId: string;
  title: string;
  description: string;
  timestamp: number;
  files: Record<string, { content: string; type: string }>;
  thumbnail?: string; // Base64 preview image (optional, for future)
  isLatest: boolean;
}

class VersionsStore {
  versions = map<Record<string, ProjectVersion>>({});
  currentVersionId = atom<string | null>(null);

  private _db: IDBDatabase | undefined;
  private _chatId: string | undefined;

  /**
   * Set the database context for version persistence.
   * Called by useChatHistory when a chat is loaded or created.
   */
  setDBContext(db: IDBDatabase | undefined, chatIdVal: string | undefined) {
    const contextChanged = this._chatId !== chatIdVal;
    this._db = db;
    this._chatId = chatIdVal;

    // Auto-persist any in-memory versions when context is first established
    if (contextChanged && db && chatIdVal && Object.keys(this.versions.get()).length > 0) {
      this._persistToDB();
    }
  }

  /**
   * Persist all current versions to IndexedDB (fire-and-forget).
   */
  private _persistToDB() {
    if (!this._db || !this._chatId) {
      return;
    }

    const allVersions = Object.values(this.versions.get());

    saveVersionsToDB(this._db, this._chatId, allVersions).catch((error) => {
      logger.warn('Failed to persist versions to IndexedDB:', error);
    });
  }

  /**
   * Load versions from IndexedDB, falling back to message sync for legacy chats.
   */
  async loadFromDB(
    db: IDBDatabase,
    chatIdVal: string,
    messages: { id: string; role: string; content: string; createdAt?: Date }[],
  ) {
    this._db = db;
    this._chatId = chatIdVal;

    try {
      const stored = await getVersionsByChatId(db, chatIdVal);

      if (stored && stored.length > 0) {
        this.versions.set({});
        this.currentVersionId.set(null);

        let latestId: string | null = null;

        for (const v of stored) {
          this.versions.setKey(v.id, v);

          if (v.isLatest) {
            latestId = v.id;
          }
        }

        if (latestId) {
          this.currentVersionId.set(latestId);
        }

        logger.trace(`Loaded ${stored.length} versions from IndexedDB for chat ${chatIdVal}`);

        return;
      }
    } catch (error) {
      logger.warn('Failed to load versions from IndexedDB, falling back to sync:', error);
    }

    // Fallback: reconstruct from messages (legacy chats without persisted versions)
    this.syncFromMessages(messages);

    // Persist the reconstructed versions so next reload uses the DB path
    this._persistToDB();
  }

  /**
   * Create a new version snapshot
   */
  createVersion(
    messageId: string,
    title: string,
    description: string,
    files: Record<string, { content: string; type: string }>,
    thumbnail?: string,
  ): ProjectVersion {
    const id = `ver-${this._generateShortId()}`;
    const timestamp = Date.now();

    // Mark all existing versions as not latest
    const currentVersions = this.versions.get();

    for (const [verId, ver] of Object.entries(currentVersions)) {
      if (ver.isLatest) {
        this.versions.setKey(verId, { ...ver, isLatest: false });
      }
    }

    const newVersion: ProjectVersion = {
      id,
      messageId,
      title,
      description,
      timestamp,
      files,
      thumbnail,
      isLatest: true,
    };

    this.versions.setKey(id, newVersion);
    this.currentVersionId.set(id);

    // Persist to IndexedDB
    this._persistToDB();

    return newVersion;
  }

  /**
   * Get all versions sorted by timestamp (newest first)
   */
  getAllVersions(): ProjectVersion[] {
    const versions = Object.values(this.versions.get());
    return versions.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get a specific version by ID
   */
  getVersion(id: string): ProjectVersion | undefined {
    return this.versions.get()[id];
  }

  /**
   * Get the latest version
   */
  getLatestVersion(): ProjectVersion | undefined {
    const versions = this.getAllVersions();
    return versions.find((v) => v.isLatest) || versions[0];
  }

  /**
   * Restore to a specific version
   */
  restoreVersion(id: string): ProjectVersion | undefined {
    const version = this.getVersion(id);

    if (version) {
      this.currentVersionId.set(id);
      return version;
    }

    return undefined;
  }

  /**
   * Generate a short random ID (like Blink's ver-k8m80qdi)
   */
  private _generateShortId(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';

    for (let i = 0; i < 8; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return result;
  }

  /**
   * Format timestamp to relative time
   */
  formatRelativeTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;

    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    const months = Math.floor(diff / 2592000000);

    if (minutes < 1) {
      return 'Just now';
    }

    if (minutes < 60) {
      return `${minutes}m ago`;
    }

    if (hours < 24) {
      return `${hours}h ago`;
    }

    if (days < 30) {
      return `${days}d ago`;
    }

    return `${months}mo ago`;
  }

  /**
   * Capture a thumbnail from the preview iframe
   * Returns a base64 data URL or undefined if capture fails
   * Uses html2canvas inside the iframe to capture actual content
   */
  async capturePreviewThumbnail(): Promise<string | undefined> {
    try {
      // Dynamic import to avoid circular dependencies
      const { requestPreviewScreenshot } = await import('~/components/workbench/Preview');
      const screenshot = await requestPreviewScreenshot({ width: 320, height: 200 }, 5000);

      return screenshot || undefined;
    } catch (error) {
      logger.warn('Failed to capture preview thumbnail:', error);
      return this._generateFallbackThumbnail();
    }
  }

  /**
   * Generate a fallback thumbnail when screenshot capture fails
   */
  private _generateFallbackThumbnail(): string | undefined {
    try {
      const width = 320;
      const height = 200;

      // Create a canvas
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');

      if (!ctx) {
        return undefined;
      }

      // Dark background with gradient
      const bgGradient = ctx.createLinearGradient(0, 0, 0, height);
      bgGradient.addColorStop(0, '#1a1f2e');
      bgGradient.addColorStop(1, '#0f1219');
      ctx.fillStyle = bgGradient;
      ctx.fillRect(0, 0, width, height);

      // Browser chrome mockup - top bar
      ctx.fillStyle = '#252a38';
      ctx.fillRect(0, 0, width, 28);

      // Traffic lights
      ctx.fillStyle = '#ff5f57';
      ctx.beginPath();
      ctx.arc(12, 14, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#febc2e';
      ctx.beginPath();
      ctx.arc(28, 14, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#28c840';
      ctx.beginPath();
      ctx.arc(44, 14, 5, 0, Math.PI * 2);
      ctx.fill();

      // URL bar
      ctx.fillStyle = '#1a1f2e';
      ctx.roundRect(60, 6, width - 70, 16, 4);
      ctx.fill();

      // Content area - page mockup
      const contentY = 38;

      // Header bar
      ctx.fillStyle = '#2d3548';
      ctx.fillRect(0, contentY, width, 32);

      // Logo placeholder
      ctx.fillStyle = '#3b82f6';
      ctx.beginPath();
      ctx.roundRect(10, contentY + 8, 60, 16, 3);
      ctx.fill();

      // Nav items
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(width - 120, contentY + 12, 30, 8);
      ctx.fillRect(width - 80, contentY + 12, 30, 8);
      ctx.fillRect(width - 40, contentY + 12, 25, 8);

      // Hero section
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(20, contentY + 50, width * 0.6, 20);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(20, contentY + 78, width * 0.45, 12);
      ctx.fillRect(20, contentY + 95, width * 0.5, 12);

      // CTA button
      ctx.fillStyle = '#3b82f6';
      ctx.beginPath();
      ctx.roundRect(20, contentY + 115, 70, 24, 4);
      ctx.fill();

      // Sidebar/content blocks
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.beginPath();
      ctx.roundRect(width - 90, contentY + 50, 70, 90, 4);
      ctx.fill();

      // Border
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

      return canvas.toDataURL('image/png', 0.8);
    } catch (error) {
      logger.warn('Failed to capture preview thumbnail:', error);
      return undefined;
    }
  }

  /**
   * Sync versions from chat messages on load.
   * This creates version entries from messages that have artifacts.
   */
  syncFromMessages(messages: { id: string; role: string; content: string; createdAt?: Date }[]): void {
    // Clear existing versions since we're syncing from chat
    this.versions.set({});
    this.currentVersionId.set(null);

    const artifactRegex = /<devonzArtifact[^>]*title="([^"]*)"[^>]*>/gi;

    let latestVersionId: string | null = null;

    for (const message of messages) {
      // Only process assistant messages
      if (message.role !== 'assistant') {
        continue;
      }

      const content = typeof message.content === 'string' ? message.content : '';

      // Find all artifacts in this message
      const matches = [...content.matchAll(artifactRegex)];

      if (matches.length === 0) {
        continue;
      }

      // Use the first artifact's title for the version
      const title = matches[0][1] || 'Project Update';

      /*
       * Create version entry (files will be empty since we don't have full snapshot).
       * The revert functionality will use messageId to rewind, not the files.
       */
      const id = `ver-${this._generateShortId()}`;
      const timestamp = message.createdAt ? new Date(message.createdAt).getTime() : Date.now();

      const version: ProjectVersion = {
        id,
        messageId: message.id,
        title,
        description: `From message: ${message.id.substring(0, 8)}...`,
        timestamp,
        files: {}, // Empty - revert uses chat rewind, not file restore
        isLatest: false,
      };

      this.versions.setKey(id, version);
      latestVersionId = id;
    }

    // Mark the last one as latest
    if (latestVersionId) {
      const latest = this.versions.get()[latestVersionId];

      if (latest) {
        this.versions.setKey(latestVersionId, { ...latest, isLatest: true });
        this.currentVersionId.set(latestVersionId);
      }
    }
  }
}

export const versionsStore = new VersionsStore();
