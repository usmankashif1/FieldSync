import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules, Platform } from 'react-native';
import { BackgroundUploadAdapter } from '../adapters/BackgroundUploadAdapter';
import { ReportImageCompressor } from '../adapters/ImageCompressor';
import { NetInfoMonitor } from '../adapters/NetInfoMonitor';
import { ReportStorageAdapter } from '../adapters/ReportStorageAdapter';
import { QueueManager } from '../queue/QueueManager';
import type { Report, ReportImage } from '../queue/types';

const LEGACY_QUEUE_STORAGE_KEY = '@field_reports_queue_v1';

interface LegacyQueueModule {
  readLegacyQueue(): Promise<string | null>;
  finishLegacyQueueMigration(): Promise<void>;
}

const storage = new ReportStorageAdapter();
const network = new NetInfoMonitor();
const manager = new QueueManager({
  storage,
  compressor: new ReportImageCompressor(),
  uploader: new BackgroundUploadAdapter(),
  network,
});
let migrationPromise: Promise<void> | undefined;

export const initializeQueue = async (): Promise<void> => {
  await network.initialize();
  await migrateLegacyQueue();
  await manager.processQueue();
};

export const getLocalQueue = async (): Promise<Report[]> => {
  await migrateLegacyQueue();
  return manager.loadAll();
};

export const subscribeToQueue = (
  listener: (reports: Report[]) => void,
): (() => void) => manager.subscribe(listener);

export const saveReportToQueue = async (
  description: string,
  imageUris: string[],
): Promise<Report> => {
  await migrateLegacyQueue();
  return manager.saveReport(description, imageUris);
};

export const retryReport = async (reportId: string): Promise<void> => {
  await migrateLegacyQueue();
  await manager.retryReport(reportId);
};

export const clearLocalQueue = async (): Promise<void> => {
  await migrateLegacyQueue();
  await manager.clearQueue();
};

export const processQueue = async (): Promise<void> => {
  await migrateLegacyQueue();
  await manager.processQueue();
};

async function migrateLegacyQueue(): Promise<void> {
  if (migrationPromise) {
    return migrationPromise;
  }
  migrationPromise = migrateLegacyQueueOnce().catch(error => {
    migrationPromise = undefined;
    throw error;
  });
  return migrationPromise;
}

async function migrateLegacyQueueOnce(): Promise<void> {
  const nativeQueue = getLegacyQueueModule();
  const nativeSerialized = nativeQueue
    ? await nativeQueue.readLegacyQueue()
    : null;
  const asyncSerialized = await AsyncStorage.getItem(LEGACY_QUEUE_STORAGE_KEY);
  const currentReports = await storage.loadAll();
  const knownIds = new Set(currentReports.map(report => report.id));
  const legacyReports = [
    ...(nativeSerialized ? parseLegacyReports(nativeSerialized) : []),
    ...(asyncSerialized ? parseLegacyReports(asyncSerialized) : []),
  ];

  for (const legacyValue of legacyReports) {
    const report = convertLegacyReport(legacyValue);
    if (!knownIds.has(report.id)) {
      await storage.save(report);
      knownIds.add(report.id);
    }
  }

  if (asyncSerialized !== null) {
    await AsyncStorage.removeItem(LEGACY_QUEUE_STORAGE_KEY);
  }
  if (nativeQueue) {
    await nativeQueue.finishLegacyQueueMigration();
  }
}

function getLegacyQueueModule(): LegacyQueueModule | undefined {
  if (Platform.OS !== 'android') {
    return undefined;
  }
  const module = NativeModules.BackgroundTransfer as
    | Partial<LegacyQueueModule>
    | undefined;
  if (
    !module ||
    typeof module.readLegacyQueue !== 'function' ||
    typeof module.finishLegacyQueueMigration !== 'function'
  ) {
    throw new Error(
      'The Android background transfer module is unavailable. Rebuild the app to restore saved reports.',
    );
  }
  return module as LegacyQueueModule;
}

function parseLegacyReports(serialized: string): unknown[] {
  const parsed: unknown = JSON.parse(serialized);
  if (!Array.isArray(parsed)) {
    throw new Error('A saved report queue has an invalid format.');
  }
  return parsed;
}

function convertLegacyReport(value: unknown): Report {
  const legacy = asRecord(value);
  const id = nonEmptyString(legacy.id) ?? createMigrationId();
  const description =
    typeof legacy.description === 'string' ? legacy.description.trim() : '';
  const rawImages = Array.isArray(legacy.images) ? legacy.images : [];
  const oldUris = Array.isArray(legacy.localImageUris)
    ? legacy.localImageUris
    : [];
  const oldUrls = Array.isArray(legacy.uploadedImageUrls)
    ? legacy.uploadedImageUrls
    : [];
  const images: ReportImage[] =
    rawImages.length > 0
      ? rawImages.map((item, index) =>
          convertLegacyImage(item, oldUris[index], oldUrls[index]),
        )
      : oldUris.map((uri, index) =>
          convertLegacyImage({ uri }, uri, oldUrls[index]),
        );
  const missingImage = images.some(
    image => !image.localUri && image.status !== 'uploaded',
  );
  const missingDescription = !description;
  const isLegacySynced = legacy.status === 'synced';
  const legacyPermanentFailure =
    legacy.status === 'failed' && legacy.retryable === false;
  const permanentFailure =
    !isLegacySynced &&
    (missingImage || missingDescription || legacyPermanentFailure);
  return {
    id,
    description: description || 'Saved report',
    images,
    status: isLegacySynced
      ? 'uploaded'
      : permanentFailure
      ? 'failed_permanent'
      : 'queued',
    createdAt:
      typeof legacy.createdAt === 'number' ? legacy.createdAt : Date.now(),
    attemptCount: typeof legacy.retryCount === 'number' ? legacy.retryCount : 0,
    lastAttemptAt:
      typeof legacy.lastAttemptAt === 'number'
        ? legacy.lastAttemptAt
        : undefined,
    lastError:
      typeof legacy.error === 'string'
        ? legacy.error
        : permanentFailure
        ? 'A saved report is missing its description or a photo and needs to be recreated.'
        : undefined,
  };
}

function convertLegacyImage(
  value: unknown,
  fallbackUri: unknown,
  fallbackUrl: unknown,
): ReportImage {
  const legacy = asRecord(value);
  const localUri =
    nonEmptyString(legacy.uri) ??
    nonEmptyString(legacy.localUri) ??
    nonEmptyString(fallbackUri) ??
    '';
  const url = nonEmptyString(legacy.url) ?? nonEmptyString(fallbackUrl);
  const status =
    legacy.status === 'completed' ||
    legacy.status === 'uploaded' ||
    Boolean(url)
      ? 'uploaded'
      : 'pending';
  const bytes =
    typeof legacy.size === 'number'
      ? legacy.size
      : typeof legacy.bytes === 'number'
      ? legacy.bytes
      : undefined;
  return {
    localUri,
    compressedUri: localUri || undefined,
    bytes,
    mimeType: 'image/jpeg',
    status,
    url,
    progress: status === 'uploaded' ? 100 : 0,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('A saved report has invalid local data.');
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function createMigrationId(): string {
  return `migrated-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
