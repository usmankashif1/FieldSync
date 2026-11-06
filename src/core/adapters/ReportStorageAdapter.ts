import AsyncStorage from '@react-native-async-storage/async-storage';
import RNFS from 'react-native-fs';
import type { Report, StorageAdapter } from '../queue/types';

const STORAGE_KEY = '@fieldsync/report-queue-v2';
let writeQueue: Promise<void> = Promise.resolve();

const toFilePath = (uri: string): string => {
  if (!uri.startsWith('file://')) {
    return uri;
  }

  return decodeURIComponent(uri.slice('file://'.length));
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const isReportImage = (
  value: unknown,
): value is Report['images'][number] => {
  return (
    isRecord(value) &&
    typeof value.localUri === 'string' &&
    ['pending', 'uploading', 'uploaded', 'failed'].includes(
      String(value.status),
    )
  );
};

const isReport = (value: unknown): value is Report => {
  if (!isRecord(value) || !Array.isArray(value.images)) {
    return false;
  }
  return (
    typeof value.id === 'string' &&
    typeof value.description === 'string' &&
    typeof value.createdAt === 'number' &&
    typeof value.attemptCount === 'number' &&
    [
      'queued',
      'preparing',
      'waiting',
      'uploading',
      'failed_retryable',
      'failed_permanent',
      'uploaded',
    ].includes(String(value.status)) &&
    value.images.every(isReportImage)
  );
};

const readReports = async (): Promise<Report[]> => {
  const serialized = await AsyncStorage.getItem(STORAGE_KEY);
  if (serialized === null) {
    return [];
  }

  const parsed: unknown = JSON.parse(serialized);
  if (!Array.isArray(parsed)) {
    throw new Error('The saved report queue has an invalid format.');
  }

  const reports: Report[] = [];
  for (const item of parsed) {
    if (!isReport(item)) {
      throw new Error('The saved report queue contains invalid report data.');
    }
    reports.push(item);
  }
  return reports;
};

const mutate = async (
  transform: (reports: Report[]) => Report[] | Promise<Report[]>,
): Promise<void> => {
  const operation = writeQueue.then(async () => {
    const reports = await readReports();
    const updated = await transform(reports);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  });

  writeQueue = operation.catch(() => undefined);
  await operation;
};

const removeCompressedImages = async (report: Report): Promise<void> => {
  const paths = report.images
    .map(image => image.compressedUri)
    .filter((path): path is string => Boolean(path))
    .map(toFilePath);

  await Promise.all(
    paths.map(async path => {
      if (await RNFS.exists(path)) {
        await RNFS.unlink(path);
      }
    }),
  );
};

const saveReport = (report: Report): Promise<void> =>
  mutate(reports => [...reports, report]);

const loadAllReports = (): Promise<Report[]> => readReports();

const updateReport = (
  id: string,
  patch: Partial<Report>,
): Promise<void> =>
  mutate(reports => {
    const index = reports.findIndex(report => report.id === id);
    if (index < 0) {
      throw new Error(`Report ${id} is missing from local storage.`);
    }

    const updated = [...reports];
    updated[index] = { ...updated[index], ...patch };
    return updated;
  });

const removeReport = (id: string): Promise<void> =>
  mutate(async reports => {
    const report = reports.find(item => item.id === id);
    if (report) {
      await removeCompressedImages(report);
    }
    return reports.filter(item => item.id !== id);
  });

const clearReports = (): Promise<void> =>
  mutate(async reports => {
    await Promise.all(reports.map(removeCompressedImages));
    return [];
  });

export const reportStorageAdapter: StorageAdapter = {
  save: saveReport,
  loadAll: loadAllReports,
  update: updateReport,
  remove: removeReport,
  clear: clearReports,
};
