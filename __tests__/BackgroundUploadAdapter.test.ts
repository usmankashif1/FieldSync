import { NativeModules, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { backgroundUploadAdapter } from '../src/core/adapters/BackgroundUploadAdapter';
import { QueueUploadError } from '../src/core/queue/types';
import type { Report } from '../src/core/queue/types';
import { getSupabaseConfiguration } from '../src/core/services/supabase';

jest.mock('react-native-fs', () => ({
  __esModule: true,
  default: {
    stat: jest.fn(),
  },
}));

jest.mock('../src/core/services/supabase', () => ({
  getSupabaseConfiguration: jest.fn(() => ({
    url: 'https://example.supabase.co',
    anonKey: 'test-publishable-key',
  })),
}));

describe('backgroundUploadAdapter', () => {
  let nativeModule: {
    startReportUpload: jest.Mock<Promise<void>>;
    getReportUploadStatus: jest.Mock<
      Promise<{
        state: string;
        progress: number;
        imageIndex?: number;
        imageUrl?: string;
        imageUrls?: string[];
        successful?: boolean;
        statusCode?: number;
        message?: string;
      }>
    >;
    cancelReportTransfers: jest.Mock<Promise<void>>;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'android',
    });
    jest.mocked(RNFS.stat).mockResolvedValue({
      size: 1200,
    } as Awaited<ReturnType<typeof RNFS.stat>>);
    nativeModule = {
      startReportUpload: jest.fn(async () => undefined),
      getReportUploadStatus: jest.fn(),
      cancelReportTransfers: jest.fn(async () => undefined),
    };
    NativeModules.BackgroundTransfer = nativeModule;
  });

  it('schedules the entire prepared report as one durable native task', async () => {
    nativeModule.getReportUploadStatus.mockResolvedValue({
      state: 'SUCCEEDED',
      progress: 100,
      successful: true,
      imageUrls: [
        'https://example.supabase.co/storage/v1/object/public/field-reports/reports/report-1/0.jpg',
        'https://example.supabase.co/storage/v1/object/public/field-reports/reports/report-1/1.jpg',
      ],
    });

    const result = await backgroundUploadAdapter.upload(
      createReport(),
      jest.fn(async () => undefined),
    );

    expect(nativeModule.startReportUpload).toHaveBeenCalledTimes(1);
    expect(nativeModule.startReportUpload).toHaveBeenCalledWith(
      'report-1',
      'Damaged sign',
      new Date(1).toISOString(),
      JSON.stringify([
        {
          filePath: '/documents/photo-0.jpg',
          mimeType: 'image/jpeg',
          contentType: 'image/jpeg',
        },
        {
          filePath: '/documents/photo-1.jpg',
          mimeType: 'image/png',
          contentType: 'image/jpeg',
        },
      ]),
      'https://example.supabase.co',
      'test-publishable-key',
    );
    expect(getSupabaseConfiguration).toHaveBeenCalled();
    expect(result.imageUrls).toHaveLength(2);
  });

  it('passes multiple photos to the worker in report order for sequential uploads', async () => {
    nativeModule.getReportUploadStatus.mockResolvedValue({
      state: 'SUCCEEDED',
      progress: 100,
      successful: true,
      imageUrls: ['photo-0-url', 'photo-1-url'],
    });

    await backgroundUploadAdapter.upload(
      createReport(),
      jest.fn(async () => undefined),
    );

    const images = JSON.parse(
      nativeModule.startReportUpload.mock.calls[0][3] as string,
    ) as Array<{ filePath: string }>;
    expect(images.map(image => image.filePath)).toEqual([
      '/documents/photo-0.jpg',
      '/documents/photo-1.jpg',
    ]);
    expect(nativeModule.startReportUpload).toHaveBeenCalledTimes(1);
  });

  it('waits for native confirmation after photo progress before resolving the report', async () => {
    nativeModule.getReportUploadStatus
      .mockResolvedValueOnce({
        state: 'RUNNING',
        progress: 100,
        imageIndex: 1,
        imageUrls: ['photo-0-url', 'photo-1-url'],
      })
      .mockResolvedValueOnce({
        state: 'SUCCEEDED',
        progress: 100,
        successful: true,
        imageUrls: ['photo-0-url', 'photo-1-url'],
      });

    await expect(
      backgroundUploadAdapter.upload(
        createReport(),
        jest.fn(async () => undefined),
      ),
    ).resolves.toEqual({ imageUrls: ['photo-0-url', 'photo-1-url'] });
    expect(nativeModule.getReportUploadStatus).toHaveBeenCalledTimes(2);
  });

  it('surfaces a permanent report-row failure from the worker', async () => {
    nativeModule.getReportUploadStatus.mockResolvedValue({
      state: 'FAILED',
      progress: 100,
      successful: false,
      statusCode: 403,
      message: 'Report row permission denied',
    });

    await expect(
      backgroundUploadAdapter.upload(
        createReport(),
        jest.fn(async () => undefined),
      ),
    ).rejects.toMatchObject<Partial<QueueUploadError>>({
      retryable: false,
      message: 'Report row permission denied',
    });
  });

  it('surfaces retryable worker network failures with their HTTP status', async () => {
    nativeModule.getReportUploadStatus.mockResolvedValue({
      state: 'FAILED',
      progress: 0,
      successful: false,
      statusCode: 503,
      message: 'Supabase is unavailable',
    });

    await expect(
      backgroundUploadAdapter.upload(
        createReport(),
        jest.fn(async () => undefined),
      ),
    ).rejects.toMatchObject<Partial<QueueUploadError>>({
      retryable: true,
      message: 'Supabase is unavailable',
    });
  });

  it('replaces a previously failed native task when the queued report is retried', async () => {
    nativeModule.getReportUploadStatus
      .mockResolvedValueOnce({
        state: 'FAILED',
        progress: 0,
        statusCode: 503,
        message: 'Supabase is unavailable',
      })
      .mockResolvedValueOnce({
        state: 'SUCCEEDED',
        progress: 100,
        successful: true,
        imageUrls: ['photo-0-url', 'photo-1-url'],
      });

    await expect(
      backgroundUploadAdapter.reconcile?.(
        { ...createReport(), status: 'queued', lastError: undefined },
        jest.fn(async () => undefined),
      ),
    ).resolves.toBeUndefined();
    await expect(
      backgroundUploadAdapter.upload(
        { ...createReport(), status: 'queued', lastError: undefined },
        jest.fn(async () => undefined),
      ),
    ).resolves.toEqual({ imageUrls: ['photo-0-url', 'photo-1-url'] });

    expect(nativeModule.startReportUpload).toHaveBeenCalledTimes(1);
  });

  it('reconciles an upload completed while JavaScript was suspended', async () => {
    nativeModule.getReportUploadStatus.mockResolvedValue({
      state: 'SUCCEEDED',
      progress: 100,
      successful: true,
      imageUrls: ['photo-0-url', 'photo-1-url'],
    });

    await expect(
      backgroundUploadAdapter.reconcile?.(
        createReport(),
        jest.fn(async () => undefined),
      ),
    ).resolves.toEqual({ imageUrls: ['photo-0-url', 'photo-1-url'] });
    expect(nativeModule.startReportUpload).not.toHaveBeenCalled();
  });

  it('restores completed-photo progress when reconciling active native work', async () => {
    nativeModule.getReportUploadStatus.mockResolvedValue({
      state: 'RUNNING',
      progress: 35,
      imageIndex: 1,
      imageUrls: ['photo-0-url'],
    });
    const progress = jest.fn(async () => undefined);

    await expect(
      backgroundUploadAdapter.reconcile?.(createReport(), progress),
    ).resolves.toBeUndefined();

    expect(progress).toHaveBeenNthCalledWith(1, {
      imageIndex: 0,
      percent: 100,
      imageUrl: 'photo-0-url',
    });
    expect(progress).toHaveBeenNthCalledWith(2, {
      imageIndex: 1,
      percent: 35,
      waiting: false,
      imageUrl: undefined,
    });
  });
});

function createReport(): Report {
  return {
    id: 'report-1',
    description: 'Damaged sign',
    images: [
      {
        localUri: 'content://photo-0',
        compressedUri: 'file:///documents/photo-0.jpg',
        bytes: 1200,
        mimeType: 'image/jpeg',
        status: 'pending',
      },
      {
        localUri: 'content://photo-1',
        compressedUri: 'file:///documents/photo-1.jpg',
        bytes: 1200,
        mimeType: 'image/png',
        status: 'pending',
      },
    ],
    status: 'uploading',
    createdAt: 1,
    attemptCount: 0,
  };
}
