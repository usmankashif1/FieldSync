import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from './supabase';
import { uploadSingleImage } from './uploadService';
import { ReportItem } from '../../screens/home/home.types';

const QUEUE_STORAGE_KEY = '@field_reports_queue_v1';
let isProcessing = false;

/**
 * Saves a new report to disk immediately before network execution.
 */
export const saveReportToQueue = async (
    description: string,
    localImageUris: string[]
): Promise<ReportItem> => {
    const newReport: ReportItem = {
        id: `report_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        description,
        localImageUris,
        uploadedImageUrls: [],
        status: 'queued',
        retryCount: 0,
        createdAt: Date.now(),
    };

    const queue = await getLocalQueue();
    queue.push(newReport);
    await AsyncStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));

    // Trigger processor immediately
    processQueue();
    return newReport;
};

/**
 * Reads the current offline queue from disk.
 */
export const getLocalQueue = async (): Promise<ReportItem[]> => {
    try {
        const raw = await AsyncStorage.getItem(QUEUE_STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (error) {
        console.error('Failed to read queue from disk:', error);
        return [];
    }
};

/**
 * Updates a specific report in the persistent disk storage.
 */
const updateReportInQueue = async (updatedReport: ReportItem): Promise<void> => {
    const queue = await getLocalQueue();
    const index = queue.findIndex((r) => r.id === updatedReport.id);
    if (index !== -1) {
        queue[index] = updatedReport;
        await AsyncStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
    }
};

/**
 * Core Queue Processor: Processes queued items sequentially, 
 * uploading each report's photos simultaneously in parallel.
 */
export const processQueue = async (): Promise<void> => {
    if (isProcessing) return;

    const netState = await NetInfo.fetch();
    if (!netState.isConnected || !netState.isInternetReachable) {
        console.log('Queue processor paused: No internet connection.');
        return;
    }

    isProcessing = true;

    try {
        const queue = await getLocalQueue();
        const pendingReports = queue.filter(
            (r) => r.status === 'queued' || r.status === 'failed'
        );

        for (const report of pendingReports) {
            // 1. Mark report as uploading on disk
            report.status = 'uploading';
            report.lastAttemptAt = Date.now();
            await updateReportInQueue(report);

            try {
                // 2. Upload all photos simultaneously using Promise.all
                const uploadPromises = report.localImageUris.map((uri) =>
                    uploadSingleImage(uri)
                );

                const results = await Promise.all(uploadPromises);

                // Check if any single photo failed
                const failedUploads = results.filter((url) => url === null);
                if (failedUploads.length > 0) {
                    throw new Error('One or more photo uploads failed during parallel transfer.');
                }

                const validUrls = results as string[];

                // 3. Post metadata payload to Supabase Database table 'reports'
                const { error: dbError } = await supabase.from('reports').insert([
                    {
                        id: report.id, // Enforces server-side idempotency
                        description: report.description,
                        image_urls: validUrls,
                        created_at: new Date(report.createdAt).toISOString(),
                    },
                ]);

                if (dbError) throw dbError;

                // 4. Mark complete on disk
                report.uploadedImageUrls = validUrls;
                report.status = 'synced';
                await updateReportInQueue(report);
                console.log(`Report ${report.id} successfully synced to server!`);

            } catch (err) {
                console.error(`Failed to upload report ${report.id}:`, err);
                report.status = 'failed';
                report.retryCount += 1;
                await updateReportInQueue(report);
            }
        }
    } finally {
        isProcessing = false;
    }
};

/**
 * Listens for network changes and processes queue automatically when online.
 */
export const initQueueNetworkListener = (): (() => void) => {
    const unsubscribe = NetInfo.addEventListener((state) => {
        if (state.isConnected && state.isInternetReachable) {
            console.log('Network restored. Triggering background queue processing...');
            processQueue();
        }
    });

    return unsubscribe;
};