import { NativeModules, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { getSupabaseConfiguration } from '../services/supabase';
import {
  MAX_IMAGE_BYTES,
  QueueUploadError,
  type Report,
  type UploadAdapter,
  type UploadProgress,
  type UploadResult,
} from '../queue/types';

const TRANSFER_POLL_INTERVAL_MS = 500;

interface ReportUploadStatus {
  state:
    | 'ENQUEUED'
    | 'RUNNING'
    | 'SUCCEEDED'
    | 'FAILED'
    | 'CANCELLED'
    | 'BLOCKED'
    | 'NOT_FOUND';
  progress: number;
  imageIndex?: number;
  imageUrl?: string;
  imageUrls?: string[];
  successful?: boolean;
  statusCode?: number;
  message?: string;
}

interface BackgroundTransferNativeModule {
  startReportUpload(
    reportId: string,
    description: string,
    createdAt: string,
    imagesJson: string,
    supabaseUrl: string,
    anonKey: string,
  ): Promise<void>;
  getReportUploadStatus(reportId: string): Promise<ReportUploadStatus>;
  cancelReportTransfers(reportId: string): Promise<void>;
}

interface PreparedImage {
  filePath: string;
  mimeType: string;
  contentType: string;
}

const toFilePath = (uri: string): string =>
  uri.startsWith('file://')
    ? decodeURIComponent(uri.slice('file://'.length))
    : uri;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const delay = (milliseconds: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, milliseconds));

const makeHttpError = (
  message: string,
  statusCode?: string | number,
): QueueUploadError => {
  const status = Number(statusCode);
  const retryable =
    statusCode === undefined ||
    status === 0 ||
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status >= 500;

  return new QueueUploadError(message, retryable);
};

const getNativeModule = (): BackgroundTransferNativeModule => {
  const nativeModule = NativeModules.BackgroundTransfer as
    | BackgroundTransferNativeModule
    | undefined;

  if (!nativeModule) {
    throw new QueueUploadError(
      'The Android background transfer module is unavailable. Rebuild the app.',
      false,
    );
  }
  return nativeModule;
};

const mapStatusError = (status: ReportUploadStatus): QueueUploadError =>
  makeHttpError(
    status.message ?? 'The background report upload failed.',
    status.statusCode,
  );

const reportProgress = async (
  status: ReportUploadStatus,
  imageCount: number,
  onProgress: (progress: UploadProgress) => Promise<void>,
): Promise<void> => {
  const completedImages = new Set<number>();
  status.imageUrls?.forEach((imageUrl, imageIndex) => {
    if (imageIndex < imageCount && imageUrl) {
      completedImages.add(imageIndex);
    }
  });
  for (const imageIndex of completedImages) {
    await onProgress({
      imageIndex,
      percent: 100,
      imageUrl: status.imageUrls?.[imageIndex],
    });
  }

  const index = status.imageIndex;
  if (
    index === undefined ||
    index < 0 ||
    index >= imageCount ||
    (completedImages.has(index) && status.progress >= 100)
  ) {
    return;
  }

  await onProgress({
    imageIndex: index,
    percent: status.progress,
    waiting: status.state === 'ENQUEUED',
    imageUrl: status.imageUrl,
  });
};

const readStatus = async (
  nativeModule: BackgroundTransferNativeModule,
  reportId: string,
): Promise<ReportUploadStatus> => {
  try {
    return await nativeModule.getReportUploadStatus(reportId);
  } catch (error) {
    throw new QueueUploadError(
      `Could not check the background report upload: ${errorMessage(error)}`,
      true,
    );
  }
};

const completedResult = (
  status: ReportUploadStatus,
  expectedImageCount: number,
): UploadResult => {
  if (
    !status.successful ||
    !status.imageUrls
  ) {
    throw mapStatusError(status);
  }
  if (
    status.imageUrls.length !== expectedImageCount ||
    status.imageUrls.some(url => !url)
  ) {
    throw new QueueUploadError(
      'The background report worker returned an incomplete photo list.',
      false,
    );
  }
  return { imageUrls: status.imageUrls };
};

const reconcileReport = async (
  report: Report,
  onProgress: (progress: UploadProgress) => Promise<void>,
): Promise<UploadResult | undefined> => {
  if (Platform.OS !== 'android') {
    return undefined;
  }

  const status = await readStatus(getNativeModule(), report.id);
  await reportProgress(status, report.images.length, onProgress);

  if (status.state === 'SUCCEEDED') {
    return completedResult(status, report.images.length);
  }
  if (status.state === 'FAILED' || status.state === 'BLOCKED') {
    const error = mapStatusError(status);
    if (report.status === 'queued') {
      return undefined;
    }
    if (report.status === 'failed_retryable' && report.lastError === error.message) {
      return undefined;
    }
    throw error;
  }
  if (status.state === 'CANCELLED') {
    const error = new QueueUploadError(
      'The background report upload was cancelled.',
      true,
    );
    if (report.status === 'queued') {
      return undefined;
    }
    if (report.status === 'failed_retryable' && report.lastError === error.message) {
      return undefined;
    }
    throw error;
  }
  return undefined;
};

const prepareImages = async (report: Report): Promise<PreparedImage[]> => {
  const images: PreparedImage[] = [];

  for (let index = 0; index < report.images.length; index += 1) {
    const image = report.images[index];
    if (!image.compressedUri || image.bytes === undefined) {
      throw new QueueUploadError(
        `Photo ${index + 1} has not been prepared.`,
        false,
      );
    }

    const filePath = toFilePath(image.compressedUri);
    let imageSize: number;
    try {
      imageSize = Number((await RNFS.stat(filePath)).size);
    } catch (error) {
      throw new QueueUploadError(
        `The saved copy of photo ${
          index + 1
        } is not available: ${errorMessage(error)}`,
        false,
      );
    }

    if (
      imageSize > MAX_IMAGE_BYTES ||
      image.bytes > MAX_IMAGE_BYTES
    ) {
      throw new QueueUploadError(
        `Photo ${index + 1} exceeds the 5,000,000-byte limit.`,
        false,
      );
    }

    images.push({
      filePath,
      mimeType: image.mimeType ?? 'image/jpeg',
      contentType: 'image/jpeg',
    });
  }

  return images;
};

const uploadReport = async (
  report: Report,
  onProgress: (progress: UploadProgress) => Promise<void>,
): Promise<UploadResult> => {
  if (Platform.OS !== 'android') {
    throw new QueueUploadError(
      'Background photo uploads are not implemented for iOS yet.',
      false,
    );
  }

  const nativeModule = getNativeModule();
  const images = await prepareImages(report);
  const { url, anonKey } = getSupabaseConfiguration();
  try {
    await nativeModule.startReportUpload(
      report.id,
      report.description,
      new Date(report.createdAt).toISOString(),
      JSON.stringify(images),
      url,
      anonKey,
    );
  } catch (error) {
    throw new QueueUploadError(
      `Could not schedule the report upload: ${errorMessage(error)}`,
      true,
    );
  }

  while (true) {
    const status = await readStatus(nativeModule, report.id);
    await reportProgress(status, report.images.length, onProgress);

    if (status.state === 'SUCCEEDED') {
      return completedResult(status, report.images.length);
    }
    if (status.state === 'FAILED' || status.state === 'BLOCKED') {
      throw mapStatusError(status);
    }
    if (status.state === 'CANCELLED') {
      throw new QueueUploadError(
        'The background report upload was cancelled.',
        true,
      );
    }
    if (status.state === 'NOT_FOUND') {
      throw new QueueUploadError(
        'The background report upload could not be found.',
        true,
      );
    }

    await delay(TRANSFER_POLL_INTERVAL_MS);
  }
};

const cancelReport = async (reportId: string): Promise<void> => {
  if (Platform.OS === 'android') {
    await getNativeModule().cancelReportTransfers(reportId);
  }
};

export const backgroundUploadAdapter: UploadAdapter = {
  upload: uploadReport,
  reconcile: reconcileReport,
  cancel: cancelReport,
};
