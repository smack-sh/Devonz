import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createBackup, listBackups, loadBackup, startAutoBackup, stopAutoBackup, type BackupData } from './autoBackup';

// In-memory localStorage implementation for tests
function createMockLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
    get length() {
      return store.size;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
  };
}

let mockStorage: Storage;

// Mock chats module
const mockGetAllChats = vi.fn();
vi.mock('./chats', () => ({
  getAllChats: (...args: unknown[]) => mockGetAllChats(...args),
}));

// Mock db module
const mockGetSnapshot = vi.fn();
const mockGetVersionsByChatId = vi.fn();
vi.mock('./db', () => ({
  getSnapshot: (...args: unknown[]) => mockGetSnapshot(...args),
  getVersionsByChatId: (...args: unknown[]) => mockGetVersionsByChatId(...args),
}));

// Mock logger
vi.mock('~/utils/logger', () => ({
  createScopedLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

const mockDb = {} as IDBDatabase;

function makeChat(id: string, timestamp: string): { id: string; timestamp: string; messages: unknown[] } {
  return {
    id,
    timestamp,
    messages: [{ role: 'user', content: 'test' }],
  };
}

describe('autoBackup', () => {
  beforeEach(() => {
    mockStorage = createMockLocalStorage();
    vi.stubGlobal('localStorage', mockStorage);
    vi.clearAllMocks();
    mockGetSnapshot.mockResolvedValue(undefined);
    mockGetVersionsByChatId.mockResolvedValue(undefined);
  });

  afterEach(() => {
    stopAutoBackup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('createBackup', () => {
    it('returns null when no chats exist', async () => {
      mockGetAllChats.mockResolvedValue([]);

      const result = await createBackup(mockDb);

      expect(result).toBeNull();
      expect(mockGetAllChats).toHaveBeenCalledWith(mockDb);
    });

    it('creates backup with correct structure (_meta, chats, snapshots, versions)', async () => {
      const chats = [makeChat('c1', '2025-01-01T12:00:00Z')];
      mockGetAllChats.mockResolvedValue(chats);
      mockGetSnapshot.mockResolvedValue({ chatIndex: 'c1', files: {} });
      mockGetVersionsByChatId.mockResolvedValue([
        { id: 'v1', messageId: 'm1', title: 'v1', description: '', timestamp: 1, files: {}, isLatest: true },
      ]);

      const key = await createBackup(mockDb);

      expect(key).not.toBeNull();
      expect(key).toMatch(/^devonz_backup_\d+$/);

      const raw = mockStorage.getItem(key!);
      expect(raw).not.toBeNull();

      const backup = JSON.parse(raw!) as BackupData;
      expect(backup._meta).toBeDefined();
      expect(backup._meta.version).toBe('1.0');
      expect(backup._meta.createdAt).toBeDefined();
      expect(backup._meta.chatCount).toBe(1);
      expect(backup.chats).toEqual(chats);
      expect(backup.snapshots).toEqual({ c1: { chatIndex: 'c1', files: {} } });
      expect(backup.versions).toEqual({
        c1: [{ id: 'v1', messageId: 'm1', title: 'v1', description: '', timestamp: 1, files: {}, isLatest: true }],
      });
    });

    it('stores backup in localStorage', async () => {
      const chats = [makeChat('c1', '2025-01-01T12:00:00Z')];
      mockGetAllChats.mockResolvedValue(chats);

      const key = await createBackup(mockDb);

      expect(key).not.toBeNull();
      expect(mockStorage.getItem(key!)).not.toBeNull();
    });

    it('rotates old backups (keeps max 3)', async () => {
      vi.useFakeTimers();

      const chats = [makeChat('c1', '2025-01-01T12:00:00Z')];
      mockGetAllChats.mockResolvedValue(chats);

      const keys: string[] = [];

      for (let i = 0; i < 4; i++) {
        const key = await createBackup(mockDb);
        expect(key).not.toBeNull();
        keys.push(key!);
        vi.advanceTimersByTime(1); // Ensure unique Date.now() per backup
      }

      const meta = JSON.parse(mockStorage.getItem('devonz_backup_meta')!);
      expect(meta.backupKeys).toHaveLength(3);
      expect(meta.backupKeys).not.toContain(keys[0]);
      expect(mockStorage.getItem(keys[0])).toBeNull();
    });

    it('handles localStorage full error gracefully (evicts old backups)', async () => {
      const chats = [makeChat('c1', '2025-01-01T12:00:00Z')];
      mockGetAllChats.mockResolvedValue(chats);

      // Pre-populate meta with existing backup keys so eviction can run
      mockStorage.setItem(
        'devonz_backup_meta',
        JSON.stringify({
          lastBackupTime: '',
          backupKeys: ['devonz_backup_100', 'devonz_backup_200'],
          chatCount: 0,
        }),
      );
      mockStorage.setItem('devonz_backup_100', 'old1');
      mockStorage.setItem('devonz_backup_200', 'old2');

      let setItemCallCount = 0;
      const originalSetItem = mockStorage.setItem.bind(mockStorage);

      mockStorage.setItem = (key: string, value: string) => {
        setItemCallCount++;

        if (setItemCallCount === 1 && key.startsWith('devonz_backup_')) {
          throw new DOMException('QuotaExceededError', 'QuotaExceededError');
        }

        originalSetItem(key, value);
      };

      const key = await createBackup(mockDb);

      expect(key).not.toBeNull();
      expect(mockStorage.getItem(key!)).not.toBeNull();

      // Eviction should have removed at least one old backup
      expect(mockStorage.getItem('devonz_backup_100')).toBeNull();
    });

    it('returns null when localStorage full and no backups to evict', async () => {
      const chats = [makeChat('c1', '2025-01-01T12:00:00Z')];
      mockGetAllChats.mockResolvedValue(chats);

      mockStorage.setItem = () => {
        throw new DOMException('QuotaExceededError', 'QuotaExceededError');
      };

      const key = await createBackup(mockDb);

      expect(key).toBeNull();
    });

    it('only backs up most recent 10 chats (sorted by timestamp)', async () => {
      const chats = Array.from({ length: 15 }, (_, i) => makeChat(`c${i}`, new Date(2025, 0, 1 + i).toISOString()));
      mockGetAllChats.mockResolvedValue(chats);

      const key = await createBackup(mockDb);

      expect(key).not.toBeNull();

      const raw = mockStorage.getItem(key!);
      const backup = JSON.parse(raw!) as BackupData;
      expect(backup.chats).toHaveLength(10);

      // Most recent = highest timestamp = last in sorted desc order
      expect(backup.chats[0].id).toBe('c14');
      expect(backup.chats[9].id).toBe('c5');
    });

    it('drops versions when backup exceeds 2MB', async () => {
      const largeContent = 'x'.repeat(1024 * 1024); // 1MB per version
      const chats = [makeChat('c1', '2025-01-01T12:00:00Z'), makeChat('c2', '2025-01-01T11:00:00Z')];
      mockGetAllChats.mockResolvedValue(chats);
      mockGetSnapshot.mockResolvedValue({ chatIndex: 'c1', files: {} });
      mockGetVersionsByChatId.mockResolvedValue([
        {
          id: 'v1',
          messageId: 'm1',
          title: 'v1',
          description: '',
          timestamp: 1,
          files: { 'a.ts': { content: largeContent, type: 'ts' } },
          isLatest: true,
        },
      ]);

      const key = await createBackup(mockDb);

      expect(key).not.toBeNull();

      const raw = mockStorage.getItem(key!);
      const backup = JSON.parse(raw!) as BackupData;
      expect(backup.versions).toEqual({});
      expect(backup.snapshots).toBeDefined();
      expect(backup.chats).toHaveLength(2);
    });

    it('drops snapshots when still too large after dropping versions', async () => {
      const largeContent = 'x'.repeat(1024 * 1024); // 1MB
      const chats = [
        makeChat('c1', '2025-01-01T12:00:00Z'),
        makeChat('c2', '2025-01-01T11:00:00Z'),
        makeChat('c3', '2025-01-01T10:00:00Z'),
      ];
      mockGetAllChats.mockResolvedValue(chats);
      mockGetSnapshot.mockResolvedValue({
        chatIndex: 'c1',
        files: { 'big.ts': { content: largeContent, type: 'ts' } },
      });
      mockGetVersionsByChatId.mockResolvedValue([]);

      const key = await createBackup(mockDb);

      expect(key).not.toBeNull();

      const raw = mockStorage.getItem(key!);
      const backup = JSON.parse(raw!) as BackupData;
      expect(backup.snapshots).toEqual({});
      expect(backup.versions).toEqual({});
      expect(backup.chats).toHaveLength(3);
    });
  });

  describe('listBackups', () => {
    it('returns empty array when no backups exist', () => {
      expect(listBackups()).toEqual([]);
    });

    it('returns correct backup info (key, createdAt, chatCount)', async () => {
      const chats = [makeChat('c1', '2025-01-01T12:00:00Z')];
      mockGetAllChats.mockResolvedValue(chats);

      const key = await createBackup(mockDb);
      expect(key).not.toBeNull();

      const backups = listBackups();
      expect(backups).toHaveLength(1);
      expect(backups[0].key).toBe(key);
      expect(backups[0].createdAt).toBeDefined();
      expect(backups[0].chatCount).toBe(1);
    });
  });

  describe('loadBackup', () => {
    it('returns parsed BackupData for valid key', async () => {
      const chats = [makeChat('c1', '2025-01-01T12:00:00Z')];
      mockGetAllChats.mockResolvedValue(chats);

      const key = await createBackup(mockDb);
      expect(key).not.toBeNull();

      const loaded = loadBackup(key!);
      expect(loaded).not.toBeNull();
      expect(loaded!._meta.version).toBe('1.0');
      expect(loaded!.chats).toHaveLength(1);
    });

    it('returns null for missing key', () => {
      expect(loadBackup('devonz_backup_nonexistent')).toBeNull();
    });

    it('returns null for invalid JSON', () => {
      mockStorage.setItem('devonz_backup_123', 'not valid json {{{');
      expect(loadBackup('devonz_backup_123')).toBeNull();
    });
  });

  describe('startAutoBackup / stopAutoBackup', () => {
    it('startAutoBackup schedules periodic backups', async () => {
      vi.useFakeTimers();

      const chats = [makeChat('c1', '2025-01-01T12:00:00Z')];
      mockGetAllChats.mockResolvedValue(chats);

      startAutoBackup(mockDb, 60_000);

      expect(listBackups()).toHaveLength(0);

      // Advance past initial 10s delay
      await vi.advanceTimersByTimeAsync(10_001);
      expect(listBackups().length).toBeGreaterThanOrEqual(1);

      // Advance interval
      await vi.advanceTimersByTimeAsync(60_000);
      expect(listBackups().length).toBeGreaterThanOrEqual(2);
    });

    it('stopAutoBackup clears the interval', async () => {
      vi.useFakeTimers();

      const chats = [makeChat('c1', '2025-01-01T12:00:00Z')];
      mockGetAllChats.mockResolvedValue(chats);

      startAutoBackup(mockDb, 60_000);
      await vi.advanceTimersByTimeAsync(10_001);

      const countBeforeStop = listBackups().length;

      stopAutoBackup();

      await vi.advanceTimersByTimeAsync(120_000);
      expect(listBackups().length).toBe(countBeforeStop);
    });

    it('startAutoBackup is idempotent (calling twice does not create two intervals)', async () => {
      vi.useFakeTimers();

      const chats = [makeChat('c1', '2025-01-01T12:00:00Z')];
      mockGetAllChats.mockResolvedValue(chats);

      startAutoBackup(mockDb, 60_000);
      startAutoBackup(mockDb, 60_000);

      await vi.advanceTimersByTimeAsync(10_001);

      const countAfterFirst = listBackups().length;

      await vi.advanceTimersByTimeAsync(60_000);

      const countAfterSecond = listBackups().length;

      expect(countAfterSecond - countAfterFirst).toBe(1);
    });
  });
});
