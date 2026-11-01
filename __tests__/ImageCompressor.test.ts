import { Image } from 'react-native-compressor';
import RNFS from 'react-native-fs';
import { ReportImageCompressor } from '../src/core/adapters/ImageCompressor';
import { QueueUploadError } from '../src/core/queue/types';

jest.mock('react-native-compressor', () => ({
  Image: {
    compress: jest.fn(),
  },
}));

jest.mock('react-native-fs', () => ({
  __esModule: true,
  default: {
    DocumentDirectoryPath: '/documents',
    mkdir: jest.fn(async () => undefined),
    stat: jest.fn(),
    copyFile: jest.fn(async () => undefined),
    exists: jest.fn(async () => false),
    unlink: jest.fn(async () => undefined),
  },
}));

describe('ReportImageCompressor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .mocked(Image.compress)
      .mockResolvedValue('file:///cache/compressed.jpg');
    jest.mocked(RNFS.stat).mockResolvedValue({
      size: 1_000_000,
    } as Awaited<ReturnType<typeof RNFS.stat>>);
  });

  it('stores a durable compressed copy and verifies its size against the limit', async () => {
    const result = await new ReportImageCompressor().compress(
      'content://source/photo',
      5_000_000,
    );

    expect(Image.compress).toHaveBeenCalledWith(
      'content://source/photo',
      expect.objectContaining({
        compressionMethod: 'manual',
        maxWidth: 2048,
        maxHeight: 2048,
        output: 'jpg',
      }),
    );
    expect(RNFS.copyFile).toHaveBeenCalledWith(
      '/cache/compressed.jpg',
      expect.stringMatching(/^\/documents\/field-report-images\/.+\.jpg$/),
    );
    expect(result.bytes).toBe(1_000_000);
    expect(result.uri).toMatch(/^file:\/\/\/documents\/field-report-images\//);
  });

  it('rejects a photo when all compression attempts remain over the byte limit', async () => {
    jest.mocked(RNFS.stat).mockResolvedValue({
      size: 5_000_001,
    } as Awaited<ReturnType<typeof RNFS.stat>>);

    await expect(
      new ReportImageCompressor().compress('content://source/photo', 5_000_000),
    ).rejects.toMatchObject<Partial<QueueUploadError>>({
      retryable: false,
    });
  });
});
