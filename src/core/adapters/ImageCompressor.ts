import { Image } from 'react-native-compressor';
import RNFS from 'react-native-fs';
import {
  QueueUploadError,
  type ImageCompressor as ImageCompressorContract,
} from '../queue/types';

const MAX_DIMENSION = 2048;
const MIN_DIMENSION = 512;
const QUALITY_STEPS = [0.88, 0.8, 0.72, 0.64, 0.56, 0.48, 0.4];
const OUTPUT_DIRECTORY = `${RNFS.DocumentDirectoryPath}/field-report-images`;

export class ReportImageCompressor implements ImageCompressorContract {
  async compress(
    uri: string,
    maxBytes: number,
  ): Promise<{ uri: string; bytes: number }> {
    try {
      await RNFS.mkdir(OUTPUT_DIRECTORY);
      let dimension = MAX_DIMENSION;

      while (dimension >= MIN_DIMENSION) {
        for (const quality of QUALITY_STEPS) {
          const compressedUri = await Image.compress(uri, {
            compressionMethod: 'manual',
            maxWidth: dimension,
            maxHeight: dimension,
            quality,
            output: 'jpg',
          });
          const compressedPath = toFilePath(compressedUri);
          try {
            const stat = await RNFS.stat(compressedPath);
            if (Number(stat.size) > maxBytes) {
              continue;
            }
            const destination = `${OUTPUT_DIRECTORY}/${createFileName()}.jpg`;
            await RNFS.copyFile(compressedPath, destination);
            const durableStat = await RNFS.stat(destination);
            if (Number(durableStat.size) > maxBytes) {
              await RNFS.unlink(destination);
              throw new QueueUploadError(
                'The compressed photo exceeds the 5,000,000-byte limit.',
                false,
              );
            }
            return {
              uri: `file://${destination}`,
              bytes: Number(durableStat.size),
            };
          } finally {
            await removeTemporaryFile(compressedPath, toFilePath(uri));
          }
        }
        dimension = Math.floor(dimension * 0.85);
      }

      throw new QueueUploadError(
        'This photo could not be reduced below the 5 MB upload limit.',
        false,
      );
    } catch (error) {
      if (error instanceof QueueUploadError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new QueueUploadError(
        `Could not prepare the photo: ${message}`,
        false,
      );
    }
  }
}

function toFilePath(uri: string): string {
  if (!uri.startsWith('file://')) {
    return uri;
  }
  return decodeURIComponent(uri.slice('file://'.length));
}

async function removeTemporaryFile(
  path: string,
  sourcePath: string,
): Promise<void> {
  if (path !== sourcePath && (await RNFS.exists(path))) {
    await RNFS.unlink(path);
  }
}

function createFileName(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
