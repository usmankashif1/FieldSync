export type ImageStatus = 'pending' | 'uploading' | 'uploaded' | 'failed';

export type ReportStatus =
  | 'queued'
  | 'preparing'
  | 'waiting'
  | 'uploading'
  | 'failed_retryable'
  | 'failed_permanent'
  | 'uploaded';

export const MAX_IMAGE_BYTES = 5_000_000;
export const MAX_REPORT_IMAGES = 5;
export const MAX_REPORT_DESCRIPTION_LENGTH = 500;

export interface ReportImage {
  localUri: string;
  compressedUri?: string;
  bytes?: number;
  mimeType?: string;
  status: ImageStatus;
  url?: string;
  progress?: number;
  error?: string;
}

export interface Report {
  id: string;
  description: string;
  images: ReportImage[];
  status: ReportStatus;
  createdAt: number;
  lastAttemptAt?: number;
  attemptCount: number;
  nextAttemptAt?: number;
  currentImageIndex?: number;
  lastError?: string;
}

export interface StorageAdapter {
  save(report: Report): Promise<void>;
  loadAll(): Promise<Report[]>;
  update(id: string, patch: Partial<Report>): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

export interface UploadProgress {
  imageIndex: number;
  percent: number;
  waiting?: boolean;
  imageUrl?: string;
}

export interface UploadResult {
  imageUrls: string[];
}

export interface UploadAdapter {
  upload(
    report: Report,
    onProgress: (progress: UploadProgress) => Promise<void>,
  ): Promise<UploadResult>;
  cancel(reportId: string): Promise<void>;
}

export interface NetworkMonitor {
  isOnline(): boolean;
  onChange(listener: (online: boolean) => void): () => void;
}

export interface ImageCompressor {
  compress(
    uri: string,
    maxBytes: number,
  ): Promise<{ uri: string; bytes: number }>;
}

export class QueueUploadError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = 'QueueUploadError';
  }
}
