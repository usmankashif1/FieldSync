import { backgroundUploadAdapter } from '../adapters/BackgroundUploadAdapter';
import { imageCompressor } from '../adapters/ImageCompressor';
import { netInfoMonitor } from '../adapters/NetInfoMonitor';
import { reportStorageAdapter } from '../adapters/ReportStorageAdapter';
import { createQueueManager } from '../queue/QueueManager';
import type { Report } from '../queue/types';


const manager = createQueueManager({
  storage: reportStorageAdapter,
  compressor: imageCompressor,
  uploader: backgroundUploadAdapter,
  network: netInfoMonitor,
});


export const initializeQueue = async (): Promise<void> => {
  await netInfoMonitor.initialize();
  await manager.processQueue();
};


export const getLocalQueue = async (): Promise<Report[]> => {
  return manager.loadAll();
};


export const subscribeToQueue = (
  listener: (reports: Report[]) => void,
): (() => void) => manager.subscribe(listener);


export const saveReportToQueue = async (
  description: string,
  imageUris: string[],
): Promise<Report> => manager.saveReport(description, imageUris);


export const retryReport = async (reportId: string): Promise<void> =>
  manager.retryReport(reportId);


export const clearLocalQueue = async (): Promise<void> => manager.clearQueue();


export const processQueue = async (): Promise<void> => manager.processQueue();
