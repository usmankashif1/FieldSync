import { supabase } from './supabase';

interface ImageUploadOptions {
    fileName?: string;
    mimeType?: string;
}

const getFileExtension = (fileName: string | undefined, mimeType: string | undefined): string => {
    const extension = fileName?.split('.').pop()?.toLowerCase();
    if (extension && extension !== fileName?.toLowerCase()) {
        return extension;
    }

    const mimeExtension = mimeType?.split('/').pop()?.toLowerCase();
    return mimeExtension && mimeExtension !== 'jpeg' ? mimeExtension : 'jpg';
};

/**
 * Uploads an image selected from the device to the configured Supabase Storage bucket.
 * The native response is converted to an ArrayBuffer for reliable React Native uploads.
 */
export const uploadSingleImage = async (
    imageUri: string,
    options: ImageUploadOptions = {},
): Promise<string> => {
    if (!imageUri) {
        throw new Error('The selected image does not have a valid URI.');
    }

    const fileExtension = getFileExtension(options.fileName, options.mimeType);
    const mimeType = options.mimeType ?? `image/${fileExtension}`;
    const uniqueFileName = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}.${fileExtension}`;
    const filePath = `reports/${uniqueFileName}`;

    const imageResponse = await fetch(imageUri);
    if (!imageResponse.ok) {
        throw new Error(`Could not read the selected image (HTTP ${imageResponse.status}).`);
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    if (imageBuffer.byteLength === 0) {
        throw new Error('The selected image is empty and cannot be uploaded.');
    }

    const { error } = await supabase.storage
        .from('field-reports')
        .upload(filePath, imageBuffer, {
            contentType: mimeType,
            upsert: false,
        });

    if (error) {
        throw new Error(`Supabase image upload failed: ${error.message}`);
    }

    const { data } = supabase.storage.from('field-reports').getPublicUrl(filePath);
    return data.publicUrl;
};