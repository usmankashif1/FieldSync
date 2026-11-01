import {
  MAX_IMAGE_BYTES,
  MAX_REPORT_DESCRIPTION_LENGTH,
  MAX_REPORT_IMAGES,
  QueueUploadError,
  type ImageCompressor,
  type NetworkMonitor,
  type Report,
  type ReportImage,
  type StorageAdapter,
  type UploadAdapter,
  type UploadProgress,
} from './types';

const RETRY_BASE_DELAY_MS = 30_000;
const RETRY_MAX_DELAY_MS = 60 * 60 * 1000;

type QueueListener = (reports: Report[]) => void;

export interface QueueManagerDependencies {
  storage: StorageAdapter;
  compressor: ImageCompressor;
  uploader: UploadAdapter;
  network: NetworkMonitor;
  createId?: () => string;
  now?: () => number;
}

export class QueueManager {
  private readonly listeners = new Set<QueueListener>();
  private processing?: Promise<void>;
  private rerunRequested = false;
  private unsubscribeNetwork?: () => void;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private online: boolean;

  constructor(private readonly dependencies: QueueManagerDependencies) {
    this.online = dependencies.network.isOnline();
    this.unsubscribeNetwork = dependencies.network.onChange(online => {
      const becameOnline = online && !this.online;
      this.online = online;
      if (becameOnline) {
        this.resumeScheduledRetries().catch(reportQueueError);
      } else if (!online) {
        this.markWaiting().catch(reportQueueError);
      }
    });
  }

  subscribe(listener: QueueListener): () => void {
    this.listeners.add(listener);
    this.publish().catch(reportQueueError);
    return () => this.listeners.delete(listener);
  }

  async loadAll(): Promise<Report[]> {
    return this.dependencies.storage.loadAll();
  }

  async saveReport(description: string, imageUris: string[]): Promise<Report> {
    const cleanDescription = description.trim();
    if (!cleanDescription) {
      throw new QueueUploadError(
        'Enter a description before saving the report.',
        false,
      );
    }
    if (cleanDescription.length > MAX_REPORT_DESCRIPTION_LENGTH) {
      throw new QueueUploadError(
        `A report description can contain no more than ${MAX_REPORT_DESCRIPTION_LENGTH} characters.`,
        false,
      );
    }
    if (imageUris.length === 0 || imageUris.length > MAX_REPORT_IMAGES) {
      throw new QueueUploadError(
        `A report must contain between 1 and ${MAX_REPORT_IMAGES} photos.`,
        false,
      );
    }
    if (imageUris.some(uri => !uri.trim())) {
      throw new QueueUploadError('A selected photo has an invalid URI.', false);
    }

    const report: Report = {
      id: this.dependencies.createId?.() ?? createReportId(),
      description: cleanDescription,
      images: imageUris.map(localUri => ({ localUri, status: 'pending' })),
      status: this.online ? 'queued' : 'waiting',
      createdAt: this.now(),
      attemptCount: 0,
    };
    await this.dependencies.storage.save(report);
    await this.publish();
    this.processQueue().catch(reportQueueError);
    return report;
  }

  async retryReport(reportId: string): Promise<void> {
    const report = await this.findReport(reportId);
    if (!report) {
      throw new Error('This report is no longer in the local queue.');
    }
    if (
      report.status !== 'failed_retryable' &&
      report.status !== 'failed_permanent'
    ) {
      throw new Error('Only a failed report can be retried.');
    }
    const resetImages = report.images.map(image =>
      image.status === 'uploaded'
        ? image
        : {
            ...image,
            status: 'pending' as const,
            progress: 0,
            error: undefined,
          },
    );
    await this.dependencies.storage.update(reportId, {
      images: resetImages,
      status: this.online ? 'queued' : 'waiting',
      attemptCount: 0,
      nextAttemptAt: undefined,
      lastError: undefined,
    });
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
    await this.publish();
    this.processQueue().catch(reportQueueError);
  }

  async clearQueue(): Promise<void> {
    const reports = await this.dependencies.storage.loadAll();
    await Promise.all(
      reports.map(report => this.dependencies.uploader.cancel(report.id)),
    );
    await this.dependencies.storage.clear();
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
    await this.publish();
  }

  processQueue(): Promise<void> {
    if (this.processing) {
      this.rerunRequested = true;
      return this.processing;
    }
    this.processing = this.processQueueUntilIdle().finally(() => {
      this.processing = undefined;
    });
    return this.processing;
  }

  dispose(): void {
    this.unsubscribeNetwork?.();
    this.unsubscribeNetwork = undefined;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
  }

  private async processPendingReports(): Promise<void> {
    const reports = await this.dependencies.storage.loadAll();
    let nextRetryAt: number | undefined;
    for (const original of reports) {
      let report = await this.findReport(original.id);
      if (!report || isTerminal(report.status)) {
        continue;
      }
      if (!this.online) {
        await this.setReportStatus(report, 'waiting');
        continue;
      }
      if (
        report.nextAttemptAt !== undefined &&
        report.nextAttemptAt > this.now()
      ) {
        nextRetryAt =
          nextRetryAt === undefined
            ? report.nextAttemptAt
            : Math.min(nextRetryAt, report.nextAttemptAt);
        continue;
      }

      try {
        report = await this.prepareImages(report);
        await this.dependencies.storage.update(report.id, {
          status: 'uploading',
          lastAttemptAt: this.now(),
          currentImageIndex: undefined,
          lastError: undefined,
        });
        report = (await this.findReport(report.id)) ?? report;
        const reportId = report.id;
        const result = await this.dependencies.uploader.upload(
          report,
          progress => this.recordProgress(reportId, progress),
        );
        const uploadedImages = report.images.map((image, index) => ({
          ...image,
          status: 'uploaded' as const,
          progress: 100,
          url: result.imageUrls[index],
          error: undefined,
        }));
        await this.dependencies.storage.update(report.id, {
          images: uploadedImages,
          status: 'uploaded',
          attemptCount: report.attemptCount + 1,
          nextAttemptAt: undefined,
          currentImageIndex: undefined,
          lastError: undefined,
        });
        await this.publish();
      } catch (error) {
        const failure = normalizeUploadError(error);
        const current = await this.findReport(report.id);
        if (!current) {
          continue;
        }
        const attemptCount = current.attemptCount + 1;
        const retryable = failure.retryable;
        const nextAttemptAt = retryable
          ? this.now() + retryDelay(attemptCount)
          : undefined;
        await this.dependencies.storage.update(report.id, {
          status: retryable ? 'failed_retryable' : 'failed_permanent',
          attemptCount,
          nextAttemptAt,
          lastError: failure.message,
          images: current.images.map(image =>
            image.status === 'uploading'
              ? { ...image, status: 'failed', error: failure.message }
              : image,
          ),
        });
        await this.publish();
        if (nextAttemptAt !== undefined) {
          nextRetryAt =
            nextRetryAt === undefined
              ? nextAttemptAt
              : Math.min(nextRetryAt, nextAttemptAt);
        }
      }
    }
    if (nextRetryAt !== undefined) {
      this.scheduleRetry(nextRetryAt - this.now());
    }
  }

  private async processQueueUntilIdle(): Promise<void> {
    do {
      this.rerunRequested = false;
      await this.processPendingReports();
    } while (this.rerunRequested);
  }

  private async prepareImages(report: Report): Promise<Report> {
    const images: ReportImage[] = [];
    for (let index = 0; index < report.images.length; index += 1) {
      const image = report.images[index];
      if (image.compressedUri && image.bytes !== undefined) {
        if (image.bytes > MAX_IMAGE_BYTES) {
          throw new QueueUploadError(
            `Photo ${index + 1} exceeds the 5,000,000-byte limit.`,
            false,
          );
        }
        images.push(image);
        continue;
      }
      await this.dependencies.storage.update(report.id, {
        status: 'preparing',
        currentImageIndex: index,
      });
      await this.publish();
      const compressed = await this.dependencies.compressor.compress(
        image.localUri,
        MAX_IMAGE_BYTES,
      );
      if (compressed.bytes > MAX_IMAGE_BYTES) {
        throw new QueueUploadError(
          `Photo ${
            index + 1
          } exceeds the 5,000,000-byte limit after compression.`,
          false,
        );
      }
      images.push({
        ...image,
        compressedUri: compressed.uri,
        bytes: compressed.bytes,
      });
      await this.dependencies.storage.update(report.id, {
        images: [...images, ...report.images.slice(index + 1)],
      });
      report = (await this.findReport(report.id)) ?? report;
    }
    report.images = images;
    return report;
  }

  private async recordProgress(
    reportId: string,
    progress: UploadProgress,
  ): Promise<void> {
    const report = await this.findReport(reportId);
    if (!report || !report.images[progress.imageIndex]) {
      return;
    }
    const images = report.images.map((image, index) =>
      index === progress.imageIndex
        ? {
            ...image,
            status: progress.imageUrl
              ? ('uploaded' as const)
              : ('uploading' as const),
            progress: progress.percent,
            url: progress.imageUrl ?? image.url,
          }
        : image,
    );
    await this.dependencies.storage.update(reportId, {
      images,
      status: progress.waiting ? 'waiting' : 'uploading',
      currentImageIndex: progress.imageIndex,
    });
    await this.publish();
  }

  private async markWaiting(): Promise<void> {
    const reports = await this.dependencies.storage.loadAll();
    for (const report of reports) {
      if (!isTerminal(report.status)) {
        await this.setReportStatus(report, 'waiting');
      }
    }
  }

  private async resumeScheduledRetries(): Promise<void> {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }

    const reports = await this.dependencies.storage.loadAll();
    for (const report of reports) {
      if (report.nextAttemptAt === undefined) {
        continue;
      }

      const images = report.images.map(image =>
        image.status === 'failed'
          ? { ...image, status: 'pending' as const, progress: 0, error: undefined }
          : image,
      );
      await this.dependencies.storage.update(report.id, {
        images,
        status: 'queued',
        nextAttemptAt: undefined,
        lastError: undefined,
      });
    }

    await this.publish();
    await this.processQueue();
  }

  private async setReportStatus(
    report: Report,
    status: Report['status'],
  ): Promise<void> {
    await this.dependencies.storage.update(report.id, { status });
    await this.publish();
  }

  private async findReport(id: string): Promise<Report | undefined> {
    return (await this.dependencies.storage.loadAll()).find(
      report => report.id === id,
    );
  }

  private async publish(): Promise<void> {
    const reports = await this.dependencies.storage.loadAll();
    const snapshot = reports.map(report => ({
      ...report,
      images: report.images.map(image => ({ ...image })),
    }));
    this.listeners.forEach(listener => listener(snapshot));
  }

  private scheduleRetry(delayMs: number): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.processQueue().catch(reportQueueError);
    }, Math.max(0, delayMs));
  }

  private now(): number {
    return this.dependencies.now?.() ?? Date.now();
  }
}

function isTerminal(status: Report['status']): boolean {
  return status === 'uploaded' || status === 'failed_permanent';
}

function normalizeUploadError(error: unknown): QueueUploadError {
  if (error instanceof QueueUploadError) {
    return error;
  }
  return new QueueUploadError(
    error instanceof Error ? error.message : String(error),
    true,
  );
}

function retryDelay(attemptCount: number): number {
  return Math.min(
    RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attemptCount - 1),
    RETRY_MAX_DELAY_MS,
  );
}

function createReportId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
    const random = Math.floor(Math.random() * 16);
    const value =
      character === 'x' ? random : 8 + Math.floor(Math.random() * 4);
    return value.toString(16);
  });
}

function reportQueueError(error: unknown): void {
  console.error('Could not update the local report queue:', error);
}
