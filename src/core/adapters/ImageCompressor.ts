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

const toFilePath = (uri: string): string => {
  if (!uri.startsWith('file://')) {
    return uri;
  }
  return decodeURIComponent(uri.slice('file://'.length));
};

const removeTemporaryFile = async (
  path: string,
  sourcePath: string,
): Promise<void> => {
  if (path !== sourcePath && (await RNFS.exists(path))) {
    await RNFS.unlink(path);
  }
};

const createFileName = (): string => {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export const imageCompressor: ImageCompressorContract = {
  compress: async (uri, maxBytes) => {
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

            return {
              uri: `file://${destination}`,
              bytes: Number(stat.size),
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
  },
};
