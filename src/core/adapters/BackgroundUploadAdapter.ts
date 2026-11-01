import NetInfo from '@react-native-community/netinfo';
import { NativeModules, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { supabase, getSupabaseConfiguration } from '../services/supabase';
import {
  MAX_IMAGE_BYTES,
  QueueUploadError,
  type Report,
  type UploadAdapter,
  type UploadProgress,
  type UploadResult,
} from '../queue/types';

const REPORT_REQUEST_TIMEOUT_MS = 120_000;
const TRANSFER_POLL_INTERVAL_MS = 500;

interface TransferStatus {
  state:
    | 'ENQUEUED'
    | 'RUNNING'
    | 'SUCCEEDED'
    | 'FAILED'
    | 'CANCELLED'
    | 'BLOCKED'
    | 'NOT_FOUND';
  progress: number;
  successful?: boolean;
  statusCode?: number;
  message?: string;
}

interface BackgroundTransferNativeModule {
  startTransfer(
    taskId: string,
    reportId: string,
    filePath: string,
    uploadUrl: string,
    anonKey: string,
    mimeType: string,
  ): Promise<void>;
  restartTransfer(
    taskId: string,
    reportId: string,
    filePath: string,
    uploadUrl: string,
    anonKey: string,
    mimeType: string,
  ): Promise<void>;
  getTransferStatus(taskId: string): Promise<TransferStatus>;
  cancelReportTransfers(reportId: string): Promise<void>;
}

export class BackgroundUploadAdapter implements UploadAdapter {
  async upload(
    report: Report,
    onProgress: (progress: UploadProgress) => Promise<void>,
  ): Promise<UploadResult> {
    if (Platform.OS !== 'android') {
      throw new QueueUploadError(
        'Background photo uploads are not implemented for iOS yet.',
        false,
      );
    }

    const imageUrls: string[] = [];
    for (let index = 0; index < report.images.length; index += 1) {
      const image = report.images[index];
      if (image.status === 'uploaded' && image.url) {
        imageUrls.push(image.url);
        continue;
      }
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
      } catch (statError) {
        throw new QueueUploadError(
          `The saved copy of photo ${
            index + 1
          } is not available: ${errorMessage(statError)}`,
          false,
        );
      }
      if (imageSize > MAX_IMAGE_BYTES || image.bytes > MAX_IMAGE_BYTES) {
        throw new QueueUploadError(
          `Photo ${index + 1} exceeds the 5,000,000-byte limit.`,
          false,
        );
      }
      const publicUrl = await this.uploadImage(
        report.id,
        index,
        filePath,
        image.mimeType ?? 'image/jpeg',
        onProgress,
      );
      imageUrls.push(publicUrl);
    }

    const request = new AbortController();
    const timeout = setTimeout(
      () => request.abort(),
      REPORT_REQUEST_TIMEOUT_MS,
    );
    let response: Awaited<ReturnType<typeof saveReportRow>>;
    try {
      response = await saveReportRow(report, imageUrls, request.signal);
    } catch (requestError) {
      if (request.signal.aborted) {
        throw new QueueUploadError(
          'The server did not respond before the report upload timed out.',
          true,
        );
      }
      throw requestError;
    } finally {
      clearTimeout(timeout);
    }
    const { error, status } = response;
    if (error) {
      throw makeHttpError(error.message, status);
    }
    return { imageUrls };
  }

  async cancel(reportId: string): Promise<void> {
    if (Platform.OS !== 'android') {
      return;
    }
    await this.getNativeModule().cancelReportTransfers(reportId);
  }

  private async uploadImage(
    reportId: string,
    imageIndex: number,
    filePath: string,
    mimeType: string,
    onProgress: (progress: UploadProgress) => Promise<void>,
  ): Promise<string> {
    const { url, anonKey } = getSupabaseConfiguration();
    const objectPath = `reports/${reportId}/${imageIndex}.${getExtension(
      mimeType,
    )}`;
    const uploadUrl = `${url.replace(
      /\/+$/,
      '',
    )}/storage/v1/object/field-reports/${encodePath(objectPath)}`;
    const taskId = `${reportId}-${imageIndex}`;
    const nativeModule = this.getNativeModule();
    let previousNetworkType: string | undefined;
    let disconnected = false;
    let restartRequested = false;
    let eventVersion = 0;
    const unsubscribe = NetInfo.addEventListener(state => {
      eventVersion += 1;
      if (state.isConnected !== true) {
        disconnected = true;
        previousNetworkType = state.type;
        return;
      }
      if (
        previousNetworkType !== undefined &&
        (disconnected || previousNetworkType !== state.type)
      ) {
        restartRequested = true;
      }
      disconnected = false;
      previousNetworkType = state.type;
    });

    try {
      const versionBeforeFetch = eventVersion;
      const currentNetwork = await NetInfo.fetch();
      if (versionBeforeFetch === eventVersion) {
        previousNetworkType = currentNetwork.type;
        disconnected = currentNetwork.isConnected !== true;
      }
      await this.schedule(
        nativeModule.startTransfer,
        nativeModule,
        taskId,
        reportId,
        filePath,
        uploadUrl,
        anonKey,
        mimeType,
      );

      let missingTaskCount = 0;
      let lastProgress = -1;
      while (true) {
        let status: TransferStatus;
        try {
          status = await nativeModule.getTransferStatus(taskId);
        } catch (error) {
          throw new QueueUploadError(
            `Could not check the background photo transfer: ${errorMessage(
              error,
            )}`,
            true,
          );
        }

        if (restartRequested && status.state !== 'SUCCEEDED') {
          restartRequested = false;
          await this.schedule(
            nativeModule.restartTransfer,
            nativeModule,
            taskId,
            reportId,
            filePath,
            uploadUrl,
            anonKey,
            mimeType,
          );
          lastProgress = -1;
          await onProgress({ imageIndex, percent: 0, waiting: true });
          continue;
        }
        if (status.state === 'SUCCEEDED') {
          if (!status.successful) {
            throw makeHttpError(
              status.message ?? 'The photo upload failed.',
              status.statusCode,
            );
          }
          const publicUrl = `${url.replace(
            /\/+$/,
            '',
          )}/storage/v1/object/public/field-reports/${objectPath}`;
          await onProgress({ imageIndex, percent: 100, imageUrl: publicUrl });
          return publicUrl;
        }
        if (
          status.state === 'FAILED' ||
          status.state === 'CANCELLED' ||
          status.state === 'BLOCKED'
        ) {
          throw makeHttpError(
            status.message ??
              'The background photo transfer stopped and will be retried.',
            status.statusCode,
          );
        }
        if (status.state === 'NOT_FOUND') {
          if (missingTaskCount > 0) {
            throw new QueueUploadError(
              'The background transfer could not be found.',
              true,
            );
          }
          missingTaskCount += 1;
          await this.schedule(
            nativeModule.startTransfer,
            nativeModule,
            taskId,
            reportId,
            filePath,
            uploadUrl,
            anonKey,
            mimeType,
          );
          continue;
        }
        if (status.progress !== lastProgress) {
          await onProgress({
            imageIndex,
            percent: status.progress,
            waiting: status.state === 'ENQUEUED',
          });
          lastProgress = status.progress;
        }
        await delay(TRANSFER_POLL_INTERVAL_MS);
      }
    } finally {
      unsubscribe();
    }
  }

  private getNativeModule(): BackgroundTransferNativeModule {
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
  }

  private async schedule(
    scheduleTransfer: BackgroundTransferNativeModule['startTransfer'],
    nativeModule: BackgroundTransferNativeModule,
    taskId: string,
    reportId: string,
    filePath: string,
    uploadUrl: string,
    anonKey: string,
    mimeType: string,
  ): Promise<void> {
    try {
      await scheduleTransfer.call(
        nativeModule,
        taskId,
        reportId,
        filePath,
        uploadUrl,
        anonKey,
        mimeType,
      );
    } catch (error) {
      throw new QueueUploadError(
        `Could not schedule the photo transfer: ${errorMessage(error)}`,
        true,
      );
    }
  }
}

function makeHttpError(
  message: string,
  statusCode?: string | number,
): QueueUploadError {
  const status = Number(statusCode);
  return new QueueUploadError(
    message,
    statusCode === undefined ||
      status === 0 ||
      status === 408 ||
      status === 425 ||
      status === 429 ||
      status >= 500,
  );
}

function saveReportRow(
  report: Report,
  imageUrls: string[],
  signal: AbortSignal,
) {
  return supabase
    .from('reports')
    .upsert(
      {
        id: report.id,
        description: report.description,
        image_urls: imageUrls,
        created_at: new Date(report.createdAt).toISOString(),
      },
      { onConflict: 'id' },
    )
    .abortSignal(signal);
}

function getExtension(mimeType: string): string {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/heic') return 'heic';
  if (mimeType === 'image/heif') return 'heif';
  return 'jpg';
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function toFilePath(uri: string): string {
  return uri.startsWith('file://')
    ? decodeURIComponent(uri.slice('file://'.length))
    : uri;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
