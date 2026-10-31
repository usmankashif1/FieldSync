export type ImageStatus = 'pending' | 'uploading' | 'completed' | 'failed';
export type ReportStatus = 'queued' | 'uploading' | 'retrying' | 'synced' | 'failed';

export const MAX_REPORT_IMAGES = 5;
export const MAX_REPORT_DESCRIPTION_LENGTH = 500;

export interface ImageProgressItem {
    uri: string;
    status: ImageStatus;
    url?: string;
    error?: string;
    size?: number;
    progress?: number;
}

export interface ReportItem {
    id: string;
    description: string;
    images: ImageProgressItem[];
    status: ReportStatus;
    retryCount: number;
    createdAt: number;
    lastAttemptAt?: number;
    retryable?: boolean;
    error?: string;
}

export interface HomeItem {
    id: string;
    description: string;
    image_urls: string[];
    created_at: string;
}
