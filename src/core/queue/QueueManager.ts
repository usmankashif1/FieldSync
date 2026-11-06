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




const isTerminal = (status: Report['status']): boolean =>
  status === 'uploaded' || status === 'failed_permanent';



const normalizeUploadError = (error: unknown): QueueUploadError =>
  error instanceof QueueUploadError
    ? error
    : new QueueUploadError(
        error instanceof Error ? error.message : String(error),
        true,
      );




const retryDelay = (attemptCount: number): number =>
  Math.min(
    RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attemptCount - 1),
    RETRY_MAX_DELAY_MS,
  );




const createReportId = (): string =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
    const random = Math.floor(Math.random() * 16);
    const value =
      character === 'x' ? random : 8 + Math.floor(Math.random() * 4);
    return value.toString(16);
  });



const reportQueueError = (error: unknown): void => {
  console.error('Could not update the local report queue:', error);
};


export const createQueueManager = (
  dependencies: QueueManagerDependencies,
) => {
  const listeners = new Set<QueueListener>();
  let processing: Promise<void> | undefined;
  let rerunRequested = false;
  let unsubscribeNetwork: (() => void) | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let online = dependencies.network.isOnline();

  const now = (): number => dependencies.now?.() ?? Date.now();

  const loadAll = (): Promise<Report[]> => dependencies.storage.loadAll();

  const findReport = async (id: string): Promise<Report | undefined> =>
    (await loadAll()).find(report => report.id === id);

  const publish = async (): Promise<void> => {  
    const reports = await loadAll();
    const snapshot = reports.map(report => ({
      ...report,
      images: report.images.map(image => ({ ...image })),
    }));
    listeners.forEach(listener => listener(snapshot));
  };

  const setReportStatus = async (
    report: Report,
    status: Report['status'],
  ): Promise<void> => {
    await dependencies.storage.update(report.id, { status });
    await publish();
  };


  const scheduleRetry = (delayMs: number): void => {
    if (retryTimer) {
      clearTimeout(retryTimer);
    }

    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      processQueue().catch(reportQueueError);
    }, Math.max(0, delayMs));
  };

  const recordProgress = async (
    reportId: string,
    progress: UploadProgress,
  ): Promise<void> => {
    const report = await findReport(reportId);
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

    await dependencies.storage.update(reportId, {
      images,
      status: progress.waiting ? 'waiting' : 'uploading',
      currentImageIndex: progress.imageIndex,
    });
    await publish();
  };

  const prepareImages = async (report: Report): Promise<Report> => {
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

      await dependencies.storage.update(report.id, {
        status: 'preparing',
        currentImageIndex: index,
      });
      await publish();

      const compressed = await dependencies.compressor.compress(
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
      await dependencies.storage.update(report.id, {
        images: [...images, ...report.images.slice(index + 1)],
      });
      report = (await findReport(report.id)) ?? report;
    }

    report.images = images;
    return report;
  };

  
  const processPendingReports = async (): Promise<void> => {
    const reports = await loadAll();
    let nextRetryAt: number | undefined;

    for (const original of reports) {
      let report = await findReport(original.id);
      if (!report || isTerminal(report.status)) {
        continue;
      }

      const reportId = report.id;
      try {
        const reconciliation = await dependencies.uploader.reconcile?.(
          report,
          progress => recordProgress(reportId, progress),
        );
        if (reconciliation) {
          const uploadedImages = report.images.map((image, index) => ({
            ...image,
            status: 'uploaded' as const,
            progress: 100,
            url: reconciliation.imageUrls[index],
            error: undefined,
          }));
          await dependencies.storage.update(report.id, {
            images: uploadedImages,
            status: 'uploaded',
            attemptCount: report.attemptCount + 1,
            nextAttemptAt: undefined,
            currentImageIndex: undefined,
            lastError: undefined,
          });
          await publish();
          continue;
        }
        if (!online) {
          await setReportStatus(report, 'waiting');
          continue;
        }
        if (
          report.nextAttemptAt !== undefined &&
          report.nextAttemptAt > now()
        ) {
          nextRetryAt =
            nextRetryAt === undefined
              ? report.nextAttemptAt
              : Math.min(nextRetryAt, report.nextAttemptAt);
          continue;
        }

        report = await prepareImages(report);
        await dependencies.storage.update(report.id, {
          status: 'uploading',
          lastAttemptAt: now(),
          currentImageIndex: undefined,
          lastError: undefined,
        });
        report = (await findReport(report.id)) ?? report;

        const result = await dependencies.uploader.upload(report, progress =>
          recordProgress(reportId, progress),
        );
        const uploadedImages = report.images.map((image, index) => ({
          ...image,
          status: 'uploaded' as const,
          progress: 100,
          url: result.imageUrls[index],
          error: undefined,
        }));

        await dependencies.storage.update(report.id, {
          images: uploadedImages,
          status: 'uploaded',
          attemptCount: report.attemptCount + 1,
          nextAttemptAt: undefined,
          currentImageIndex: undefined,
          lastError: undefined,
        });
        await publish();
      } catch (error) {
        const failure = normalizeUploadError(error);
        const current = await findReport(report.id);
        if (!current) {
          continue;
        }

        const attemptCount = current.attemptCount + 1;
        const nextAttemptAt = failure.retryable
          ? now() + retryDelay(attemptCount)
          : undefined;

        await dependencies.storage.update(report.id, {
          status: failure.retryable ? 'failed_retryable' : 'failed_permanent',
          attemptCount,
          nextAttemptAt,
          lastError: failure.message,
          images: current.images.map(image =>
            image.status === 'uploading'
              ? { ...image, status: 'failed', error: failure.message }
              : image,
          ),
        });
        await publish();

        if (nextAttemptAt !== undefined) {
          nextRetryAt =
            nextRetryAt === undefined
              ? nextAttemptAt
              : Math.min(nextRetryAt, nextAttemptAt);
        }
      }
    }

    if (nextRetryAt !== undefined) {
      scheduleRetry(nextRetryAt - now());
    }
  };

  const processQueueUntilIdle = async (): Promise<void> => {
    do {
      rerunRequested = false;
      await processPendingReports();
    } while (rerunRequested);
  };

  const processQueue = (): Promise<void> => {
    if (processing) {
      rerunRequested = true;
      return processing;
    }

    processing = processQueueUntilIdle().finally(() => {
      processing = undefined;
    });
    return processing;
  };

  const subscribe = (listener: QueueListener): (() => void) => {
    listeners.add(listener);
    publish().catch(reportQueueError);
    return () => listeners.delete(listener);
  };

  const saveReport = async (
    description: string,
    imageUris: string[],
  ): Promise<Report> => {
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
      id: dependencies.createId?.() ?? createReportId(),
      description: cleanDescription,
      images: imageUris.map(localUri => ({ localUri, status: 'pending' })),
      status: online ? 'queued' : 'waiting',
      createdAt: now(),
      attemptCount: 0,
    };

    await dependencies.storage.save(report);
    await publish();
    processQueue().catch(reportQueueError);
    return report;
  };

  const retryReport = async (reportId: string): Promise<void> => {
    const report = await findReport(reportId);
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

    await dependencies.storage.update(reportId, {
      images: resetImages,
      status: online ? 'queued' : 'waiting',
      attemptCount: 0,
      nextAttemptAt: undefined,
      lastError: undefined,
    });
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = undefined;
    }

    await publish();
    processQueue().catch(reportQueueError);
  };

  const clearQueue = async (): Promise<void> => {
    const reports = await loadAll();
    await Promise.all(
      reports.map(report => dependencies.uploader.cancel(report.id)),
    );
    await dependencies.storage.clear();

    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = undefined;
    }
    await publish();
  };

  const markWaiting = async (): Promise<void> => {
    const reports = await loadAll();
    for (const report of reports) {
      if (!isTerminal(report.status)) {
        await setReportStatus(report, 'waiting');
      }
    }
  };

  const resumeScheduledRetries = async (): Promise<void> => {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = undefined;
    }

    const reports = await loadAll();
    for (const report of reports) {
      if (report.nextAttemptAt === undefined) {
        continue;
      }

      const images = report.images.map(image =>
        image.status === 'failed'
          ? {
              ...image,
              status: 'pending' as const,
              progress: 0,
              error: undefined,
            }
          : image,
      );
      await dependencies.storage.update(report.id, {
        images,
        status: 'queued',
        nextAttemptAt: undefined,
        lastError: undefined,
      });
    }

    await publish();
    await processQueue();
  };

  const dispose = (): void => {
    unsubscribeNetwork?.();
    unsubscribeNetwork = undefined;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = undefined;
    }
  };

  unsubscribeNetwork = dependencies.network.onChange(isOnline => {
    const becameOnline = isOnline && !online;
    online = isOnline;

    if (becameOnline) {
      resumeScheduledRetries().catch(reportQueueError);
    } else if (!isOnline) {
      markWaiting().catch(reportQueueError);
    }
  });

  return {
    subscribe,
    loadAll,
    saveReport,
    retryReport,
    clearQueue,
    processQueue,
    dispose,
  };
};
