import { QueueManager } from '../src/core/queue/QueueManager';
import { QueueUploadError } from '../src/core/queue/types';
import type {
  ImageCompressor,
  NetworkMonitor,
  Report,
  StorageAdapter,
  UploadAdapter,
} from '../src/core/queue/types';

class MemoryStorage implements StorageAdapter {
  reports: Report[] = [];

  async save(report: Report): Promise<void> {
    this.reports = [...this.reports, report];
  }

  async loadAll(): Promise<Report[]> {
    return this.reports.map(report => ({
      ...report,
      images: report.images.map(image => ({ ...image })),
    }));
  }

  async update(id: string, patch: Partial<Report>): Promise<void> {
    this.reports = this.reports.map(report =>
      report.id === id ? { ...report, ...patch } : report,
    );
  }

  async remove(id: string): Promise<void> {
    this.reports = this.reports.filter(report => report.id !== id);
  }

  async clear(): Promise<void> {
    this.reports = [];
  }
}

class FakeNetwork implements NetworkMonitor {
  online = false;
  private readonly listeners = new Set<(online: boolean) => void>();

  isOnline(): boolean {
    return this.online;
  }

  onChange(listener: (online: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setOnline(online: boolean): void {
    this.online = online;
    this.listeners.forEach(listener => listener(online));
  }
}

describe('QueueManager', () => {
  let storage: MemoryStorage;
  let network: FakeNetwork;
  let compressor: jest.Mocked<ImageCompressor>;
  let uploader: jest.Mocked<UploadAdapter>;
  let manager: QueueManager;

  beforeEach(() => {
    storage = new MemoryStorage();
    network = new FakeNetwork();
    compressor = {
      compress: jest.fn(async (uri: string, _maxBytes: number) => ({
        uri: `file:///compressed/${uri.split('/').pop()}`,
        bytes: 1200,
      })),
    };
    uploader = {
      upload: jest.fn(async (report, onProgress) => {
        await Promise.all(
          report.images.map((_, imageIndex) =>
            onProgress({ imageIndex, percent: 100 }),
          ),
        );
        return {
          imageUrls: report.images.map(
            (_, index) => `https://cdn.test/${index}.jpg`,
          ),
        };
      }),
      cancel: jest.fn(async (_reportId: string) => undefined),
    };
    manager = new QueueManager({
      storage,
      compressor,
      uploader,
      network,
      createId: () => 'report-id',
      now: () => 1_000,
    });
  });

  afterEach(() => {
    manager.dispose();
  });

  it('saves the report locally while offline without invoking compression or upload', async () => {
    const report = await manager.saveReport('Damaged sign', [
      'content://photo',
    ]);

    expect(report.status).toBe('waiting');
    expect(storage.reports).toHaveLength(1);
    expect(compressor.compress).not.toHaveBeenCalled();
    expect(uploader.upload).not.toHaveBeenCalled();
  });

  it('automatically uploads reports when the network reconnects', async () => {
    await manager.saveReport('Damaged sign', ['content://photo']);

    network.setOnline(true);
    await manager.processQueue();

    expect(uploader.upload).toHaveBeenCalledTimes(1);
    expect(storage.reports[0].status).toBe('uploaded');
  });

  it('retries a scheduled upload immediately when the network reconnects', async () => {
    network.setOnline(true);
    uploader.upload.mockRejectedValueOnce(
      new QueueUploadError('Network interrupted', true),
    );
    await manager.saveReport('Damaged sign', ['content://photo']);
    await manager.processQueue();
    expect(storage.reports[0].status).toBe('failed_retryable');

    network.setOnline(false);
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    network.setOnline(true);
    await manager.processQueue();

    expect(uploader.upload).toHaveBeenCalledTimes(2);
    expect(storage.reports[0].status).toBe('uploaded');
  });

  it('compresses images in TypeScript before using the upload adapter', async () => {
    network.setOnline(true);
    await manager.saveReport('Damaged sign', [
      'content://one',
      'content://two',
    ]);
    await manager.processQueue();

    expect(compressor.compress).toHaveBeenCalledTimes(2);
    expect(compressor.compress).toHaveBeenCalledWith(
      'content://one',
      5_000_000,
    );
    expect(uploader.upload).toHaveBeenCalledTimes(1);
    expect(uploader.upload.mock.calls[0][0].images[0].compressedUri).toContain(
      '/compressed/',
    );
    expect(storage.reports[0].status).toBe('uploaded');
    expect(storage.reports[0].images.map(image => image.status)).toEqual([
      'uploaded',
      'uploaded',
    ]);
  });

  it('persists retryable failures for TypeScript-managed backoff', async () => {
    network.setOnline(true);
    uploader.upload.mockRejectedValueOnce(
      new QueueUploadError('Network interrupted', true),
    );
    await manager.saveReport('Damaged sign', ['content://one']);
    await manager.processQueue();

    expect(storage.reports[0].status).toBe('failed_retryable');
    expect(storage.reports[0].attemptCount).toBe(1);
    expect(storage.reports[0].nextAttemptAt).toBe(31_000);
  });

  it('marks invalid permanent upload failures without scheduling a retry', async () => {
    network.setOnline(true);
    uploader.upload.mockRejectedValueOnce(
      new QueueUploadError('Invalid authorization', false),
    );
    await manager.saveReport('Damaged sign', ['content://one']);
    await manager.processQueue();

    expect(storage.reports[0].status).toBe('failed_permanent');
    expect(storage.reports[0].nextAttemptAt).toBeUndefined();
  });
});
