import { NativeModules, Platform } from 'react-native';
import NetInfo, {
  type NetInfoChangeHandler,
  type NetInfoState,
} from '@react-native-community/netinfo';
import RNFS from 'react-native-fs';
import { BackgroundUploadAdapter } from '../src/core/adapters/BackgroundUploadAdapter';
import { QueueUploadError } from '../src/core/queue/types';
import type { Report } from '../src/core/queue/types';
import { supabase } from '../src/core/services/supabase';

jest.mock('react-native-fs', () => ({
  __esModule: true,
  default: {
    stat: jest.fn(),
  },
}));

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(),
    fetch: jest.fn(),
  },
}));

jest.mock('../src/core/services/supabase', () => ({
  getSupabaseConfiguration: () => ({
    url: 'https://example.supabase.co',
    anonKey: 'test-key',
  }),
  supabase: {
    from: jest.fn(() => ({
      upsert: jest.fn(() => ({
        abortSignal: jest.fn(async () => ({ error: null, status: 200 })),
      })),
    })),
  },
}));

describe('BackgroundUploadAdapter', () => {
  let nativeModule: {
    startTransfer: jest.Mock<Promise<void>>;
    restartTransfer: jest.Mock<Promise<void>>;
    getTransferStatus: jest.Mock<
      Promise<{
        state: string;
        progress: number;
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
    jest.mocked(NetInfo.addEventListener).mockReturnValue(() => undefined);
    jest.mocked(NetInfo.fetch).mockResolvedValue(networkState('wifi'));
    nativeModule = {
      startTransfer: jest.fn(async () => undefined),
      restartTransfer: jest.fn(async () => undefined),
      getTransferStatus: jest.fn(),
      cancelReportTransfers: jest.fn(async () => undefined),
    };
    NativeModules.BackgroundTransfer = nativeModule;
  });

  it('uses the native transfer bridge and then saves the report row through the adapter', async () => {
    nativeModule.getTransferStatus.mockResolvedValue({
      state: 'SUCCEEDED',
      progress: 100,
      successful: true,
      statusCode: 200,
    });
    const progress = jest.fn(async () => undefined);

    const result = await new BackgroundUploadAdapter().upload(
      createReport(),
      progress,
    );

    expect(nativeModule.startTransfer).toHaveBeenCalledWith(
      'report-1-0',
      'report-1',
      '/documents/photo.jpg',
      expect.stringContaining('/storage/v1/object/field-reports/'),
      'test-key',
      'image/jpeg',
    );
    expect(supabase.from).toHaveBeenCalledWith('reports');
    expect(result.imageUrls).toEqual([
      'https://example.supabase.co/storage/v1/object/public/field-reports/reports/report-1/0.jpg',
    ]);
    expect(progress).toHaveBeenCalledWith({
      imageIndex: 0,
      percent: 100,
      imageUrl: result.imageUrls[0],
    });
  });

  it('replaces an active transfer after a Wi-Fi to cellular route change', async () => {
    let onNetChange: NetInfoChangeHandler | undefined;
    jest.mocked(NetInfo.addEventListener).mockImplementation(listener => {
      onNetChange = listener;
      return () => undefined;
    });
    nativeModule.getTransferStatus
      .mockImplementationOnce(async () => {
        onNetChange?.(networkState('cellular'));
        return { state: 'RUNNING', progress: 20 };
      })
      .mockResolvedValueOnce({
        state: 'SUCCEEDED',
        progress: 100,
        successful: true,
        statusCode: 200,
      });

    await new BackgroundUploadAdapter().upload(
      createReport(),
      jest.fn(async () => undefined),
    );

    expect(nativeModule.restartTransfer).toHaveBeenCalledTimes(1);
  });

  it('surfaces permanent HTTP errors instead of retrying them as network failures', async () => {
    nativeModule.getTransferStatus.mockResolvedValue({
      state: 'SUCCEEDED',
      progress: 100,
      successful: false,
      statusCode: 403,
      message: 'Upload permission denied',
    });

    await expect(
      new BackgroundUploadAdapter().upload(
        createReport(),
        jest.fn(async () => undefined),
      ),
    ).rejects.toMatchObject<Partial<QueueUploadError>>({
      retryable: false,
      message: 'Upload permission denied',
    });
  });
});

function createReport(): Report {
  return {
    id: 'report-1',
    description: 'Damaged sign',
    images: [
      {
        localUri: 'content://photo',
        compressedUri: 'file:///documents/photo.jpg',
        bytes: 1200,
        mimeType: 'image/jpeg',
        status: 'pending',
      },
    ],
    status: 'uploading',
    createdAt: 1,
    attemptCount: 0,
  };
}

function networkState(type: string): NetInfoState {
  return {
    type,
    isConnected: true,
    isInternetReachable: true,
    details: null,
  } as NetInfoState;
}
