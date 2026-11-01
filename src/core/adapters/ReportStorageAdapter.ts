import AsyncStorage from '@react-native-async-storage/async-storage';
import RNFS from 'react-native-fs';
import type { Report, StorageAdapter } from '../queue/types';

const STORAGE_KEY = '@fieldsync/report-queue-v2';

export class ReportStorageAdapter implements StorageAdapter {
  private writeQueue: Promise<void> = Promise.resolve();

  async save(report: Report): Promise<void> {
    await this.mutate(reports => [...reports, report]);
  }

  loadAll(): Promise<Report[]> {
    return this.readReports();
  }

  async update(id: string, patch: Partial<Report>): Promise<void> {
    await this.mutate(reports => {
      const index = reports.findIndex(report => report.id === id);
      if (index < 0) {
        throw new Error(`Report ${id} is missing from local storage.`);
      }
      const updated = [...reports];
      updated[index] = { ...updated[index], ...patch };
      return updated;
    });
  }

  async remove(id: string): Promise<void> {
    await this.mutate(async reports => {
      const report = reports.find(item => item.id === id);
      if (report) {
        await removeCompressedImages(report);
      }
      return reports.filter(item => item.id !== id);
    });
  }

  async clear(): Promise<void> {
    await this.mutate(async reports => {
      await Promise.all(reports.map(removeCompressedImages));
      return [];
    });
  }

  private async mutate(
    transform: (reports: Report[]) => Report[] | Promise<Report[]>,
  ): Promise<void> {
    const operation = this.writeQueue.then(async () => {
      const reports = await this.readReports();
      const updated = await transform(reports);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    });
    this.writeQueue = operation.catch(() => undefined);
    await operation;
  }

  private async readReports(): Promise<Report[]> {
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
  }
}

function isReport(value: unknown): value is Report {
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
}

function isReportImage(value: unknown): value is Report['images'][number] {
  return (
    isRecord(value) &&
    typeof value.localUri === 'string' &&
    ['pending', 'uploading', 'uploaded', 'failed'].includes(
      String(value.status),
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function removeCompressedImages(report: Report): Promise<void> {
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
}

function toFilePath(uri: string): string {
  if (!uri.startsWith('file://')) {
    return uri;
  }
  return decodeURIComponent(uri.slice('file://'.length));
}
