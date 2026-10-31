export type UploadStatus = 'queued' | 'uploading' | 'synced' | 'failed';

export interface ReportItem {
  id: string; // Unique Report UUID (enforces idempotency)
  description: string;
  localImageUris: string[]; // 1 to 5 local file paths
  uploadedImageUrls: string[]; // Populated as uploads succeed
  status: UploadStatus;
  retryCount: number;
  createdAt: number;
  lastAttemptAt?: number;
}