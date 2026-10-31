import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { AppState, NativeModules, Platform } from 'react-native';
import {
    MAX_REPORT_DESCRIPTION_LENGTH,
    MAX_REPORT_IMAGES,
    type ReportItem,
} from '../../screens/home/home.types';
import { getSupabaseConfiguration } from './supabase';

const LEGACY_QUEUE_STORAGE_KEY = '@field_reports_queue_v1';
const QUEUE_POLL_INTERVAL_MS = 2500;

interface NativeReportQueue {
    getReports(): Promise<ReportItem[]>;
    recoverInterruptedUploads(): Promise<void>;
    enqueueReport(description: string, imageUris: string[]): Promise<ReportItem>;
    retryReport(reportId: string): Promise<void>;
    clearQueue(): Promise<void>;
    migrateLegacyQueue(legacyQueue: string): Promise<void>;
    scheduleQueue(url: string, anonKey: string, delayMs: number): Promise<void>;
}

type QueueListener = (reports: ReportItem[]) => void;

export class QueueSchedulingError extends Error {
    constructor(readonly report: ReportItem, cause: unknown) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        super(`The report is saved on this device, but its upload could not be scheduled. ${detail}`);
        this.name = 'QueueSchedulingError';
    }
}

const listeners = new Set<QueueListener>();
let pollingTimer: ReturnType<typeof setInterval> | undefined;
let isPolling = false;
let schedulingPromise: Promise<void> | undefined;
let migrationPromise: Promise<void> | undefined;

const getNativeQueue = (): NativeReportQueue => {
    if (Platform.OS !== 'android') {
        throw new Error('Background report uploads are currently supported on Android only.');
    }

    const nativeQueue = NativeModules.FieldReportQueue as NativeReportQueue | undefined;
    if (!nativeQueue) {
        throw new Error('The native report upload module is unavailable. Rebuild the Android app.');
    }

    return nativeQueue;
};

const publishQueue = (reports: ReportItem[]): void => {
    const snapshot = reports.map(report => ({
        ...report,
        images: report.images.map(image => ({ ...image })),
    }));
    listeners.forEach(listener => listener(snapshot));
};

const refreshQueue = async (): Promise<void> => {
    if (isPolling || AppState.currentState !== 'active' || listeners.size === 0) {
        return;
    }

    isPolling = true;
    try {
        publishQueue(await getNativeQueue().getReports());
    } catch (error) {
        console.error('Could not refresh the local report queue:', error);
    } finally {
        isPolling = false;
    }
};

const ensureLegacyQueueMigrated = (): Promise<void> => {
    if (migrationPromise) {
        return migrationPromise;
    }

    migrationPromise = (async () => {
        const legacyQueue = await AsyncStorage.getItem(LEGACY_QUEUE_STORAGE_KEY);
        if (!legacyQueue) {
            return;
        }

        await getNativeQueue().migrateLegacyQueue(legacyQueue);
        await AsyncStorage.removeItem(LEGACY_QUEUE_STORAGE_KEY);
    })().catch(error => {
        migrationPromise = undefined;
        throw error;
    });

    return migrationPromise;
};

const scheduleQueue = async (delayMs = 0): Promise<void> => {
    const { url, anonKey } = getSupabaseConfiguration();
    await getNativeQueue().scheduleQueue(url, anonKey, delayMs);
};

/**
 * Migrates previously queued reports, then asks Android to resume durable work.
 */
export const initializeQueue = async (): Promise<void> => {
    await ensureLegacyQueueMigrated();
    await getNativeQueue().recoverInterruptedUploads();
    await processQueue();
};

/**
 * Reads the device-persisted queue. Server history is loaded separately.
 */
export const getLocalQueue = async (): Promise<ReportItem[]> => {
    await ensureLegacyQueueMigrated();
    return getNativeQueue().getReports();
};

/**
 * Subscribes to native queue updates while the app is in the foreground.
 */
export const subscribeToQueue = (listener: QueueListener): (() => void) => {
    listeners.add(listener);
    refreshQueue();

    if (!pollingTimer) {
        pollingTimer = setInterval(() => {
            refreshQueue();
        }, QUEUE_POLL_INTERVAL_MS);
    }

    return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && pollingTimer) {
            clearInterval(pollingTimer);
            pollingTimer = undefined;
        }
    };
};

/**
 * Saves a durable report before scheduling its background upload.
 */
export const saveReportToQueue = async (
    description: string,
    imageUris: string[],
): Promise<ReportItem> => {
    const cleanDescription = description.trim();
    if (!cleanDescription) {
        throw new Error('Enter a description before saving the report.');
    }
    if (cleanDescription.length > MAX_REPORT_DESCRIPTION_LENGTH) {
        throw new Error(`A report description can contain no more than ${MAX_REPORT_DESCRIPTION_LENGTH} characters.`);
    }
    if (imageUris.length === 0) {
        throw new Error('Select at least one photo before saving the report.');
    }
    if (imageUris.length > MAX_REPORT_IMAGES) {
        throw new Error(`A report can contain no more than ${MAX_REPORT_IMAGES} photos.`);
    }

    await ensureLegacyQueueMigrated();
    const report = await getNativeQueue().enqueueReport(cleanDescription, imageUris);
    refreshQueue();

    try {
        await scheduleQueue();
    } catch (error) {
        throw new QueueSchedulingError(report, error);
    }

    return report;
};

/**
 * Explicitly retries a report after the user has reviewed its failure.
 */
export const retryReport = async (reportId: string): Promise<void> => {
    await ensureLegacyQueueMigrated();
    await getNativeQueue().retryReport(reportId);
    const reports = await getNativeQueue().getReports();
    publishQueue(reports);
    const retriedReport = reports.find(report => report.id === reportId);
    if (!retriedReport) {
        throw new Error('The report was not found after its retry was saved.');
    }

    try {
        await scheduleQueue();
    } catch (error) {
        throw new QueueSchedulingError(retriedReport, error);
    }
};

/**
 * Clears local queue history and local photo copies; server data is unchanged.
 */
export const clearLocalQueue = async (): Promise<void> => {
    await ensureLegacyQueueMigrated();
    await getNativeQueue().clearQueue();
    publishQueue([]);
};

/**
 * Schedules durable Android work for any report that is not terminal.
 */
export const processQueue = (): Promise<void> => {
    if (schedulingPromise) {
        return schedulingPromise;
    }

    schedulingPromise = (async () => {
        await ensureLegacyQueueMigrated();
        const reports = await getNativeQueue().getReports();
        const hasWork = reports.some(report =>
            report.status === 'queued' ||
            report.status === 'uploading' ||
            report.status === 'retrying' ||
            (report.status === 'failed' && report.retryable),
        );

        if (hasWork) {
            await scheduleQueue();
        }
    })().finally(() => {
        schedulingPromise = undefined;
    });

    return schedulingPromise;
};

/**
 * Schedules pending reports promptly when connectivity returns.
 */
export const initQueueNetworkListener = (): (() => void) =>
    (() => {
        let wasOnline = false;
        return NetInfo.addEventListener(state => {
            // Carrier networks can fail NetInfo's reachability probe while still passing traffic.
            // WorkManager's CONNECTED constraint is the authoritative upload gate.
            const isOnline = state.isConnected === true;
            if (isOnline && !wasOnline) {
                processQueue().catch(error => console.error('Could not resume the report queue:', error));
            }
            wasOnline = isOnline;
        });
    })();
