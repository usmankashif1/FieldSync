import React, { useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, TextInput, View } from 'react-native';
import type { Asset, ImagePickerResponse } from 'react-native-image-picker';
import AppButton from '../../../components/AppButton';
import AppText from '../../../components/AppText';
import { openPermissionSettings, requestCameraPermission, requestGalleryPermission } from '../../../core/permissions/permissionService';
import { defaultTheme } from '../../../core/theme/defaultTheme';
import { getErrorMessage } from '../../../core/utils/errorMessage';
import { showErrorToast, showInfoToast, showSuccessToast } from '../../../core/utils/toast';
import { saveReportToQueue } from '../../../core/services/queueEngine';
import { MAX_REPORT_DESCRIPTION_LENGTH, MAX_REPORT_IMAGES } from '../../../core/queue/types';

const ReportComposer = () => {
    const [description, setDescription] = useState('');
    const [photos, setPhotos] = useState<Asset[]>([]);
    const [busy, setBusy] = useState(false);




    const handlePermissionResult = (permission: 'granted' | 'limited' | 'denied' | 'blocked' | 'unavailable', label: string): boolean => {
        if (permission === 'granted' || permission === 'limited') {
            return true;
        }
        if (permission === 'blocked') {
            Alert.alert(`${label} access is blocked`, 'Allow access in Settings, then try again.', [
                { text: 'Not now', style: 'cancel' },
                {
                    text: 'Open Settings',
                    onPress: () => {
                        openPermissionSettings().catch(error => showErrorToast('Could not open Settings', getErrorMessage(error)));
                    },
                },
            ]);
            return false;
        }
        if (permission === 'denied') {
            showInfoToast(`${label} access needed`, `Allow ${label.toLowerCase()} access to add photos.`);
            return false;
        }

        showErrorToast(`${label} access unavailable`, 'This device does not support this permission.');
        return false;
    };






    const addPickedPhotos = (response: ImagePickerResponse): void => {
        if (response.didCancel) {
            return;
        }
        if (response.errorCode) {
            showErrorToast('Could not select photos', response.errorMessage ?? 'Please try selecting the photos again.');
            return;
        }

        const selected = (response.assets ?? []).filter(
            (asset): asset is Asset & { uri: string } => Boolean(asset.uri),
        );

        if (selected.length === 0) {
            showErrorToast('No usable photo selected', 'Select a photo that is available on this device.');
            return;
        }

        const remaining = MAX_REPORT_IMAGES - photos.length;

        if (selected.length > remaining) {
            showErrorToast('Photo limit reached', `A report can contain up to ${MAX_REPORT_IMAGES} photos. You can add ${remaining} more.`);
            return;
        }

        const existingUris = new Set(photos.map(photo => photo.uri));

        const uniquePhotos = selected.filter(photo => !existingUris.has(photo.uri));

        if (uniquePhotos.length === 0) {
            showInfoToast('Photo already selected', 'Choose a different photo for this report.');
            return;
        }
        setPhotos(current => [...current, ...uniquePhotos]);
    };





    const pickFromGallery = async (): Promise<void> => {
        setBusy(true);
        try {
            const permission = await requestGalleryPermission();
            if (!handlePermissionResult(permission, 'Photo library')) {
                return;
            }

            const { launchImageLibrary } = require('react-native-image-picker') as typeof import('react-native-image-picker');
            const response = await launchImageLibrary({
                mediaType: 'photo',
                selectionLimit: MAX_REPORT_IMAGES - photos.length,
                quality: 1,
            });
            addPickedPhotos(response);
        } catch (error) {
            showErrorToast('Could not open the photo library', getErrorMessage(error));
        } finally {
            setBusy(false);
        }
    };





    const takePhoto = async (): Promise<void> => {
        if (photos.length >= MAX_REPORT_IMAGES) {
            showErrorToast('Photo limit reached', `A report can contain up to ${MAX_REPORT_IMAGES} photos.`);
            return;
        }

        setBusy(true);
        try {
            const permission = await requestCameraPermission();
            if (!handlePermissionResult(permission, 'Camera')) {
                return;
            }

            const { launchCamera } = require('react-native-image-picker') as typeof import('react-native-image-picker');
            
            const response = await launchCamera({
                mediaType: 'photo',
                quality: 1,
                saveToPhotos: false,
            });

            addPickedPhotos(response);

        } catch (error) {
            showErrorToast('Could not open the camera', getErrorMessage(error));
        } finally {
            setBusy(false);
        }
    };




    const handleSaveReport = async (): Promise<void> => {
        const cleanDescription = description.trim();
        if (!cleanDescription) {
            showErrorToast('Description required', 'Add a short description before saving the report.');
            return;
        }

        if (photos.length === 0 || photos.length > MAX_REPORT_IMAGES) {
            showErrorToast('Add 1-5 photos', 'A report needs at least one photo and can contain no more than five.');
            return;
        }

        setBusy(true);
        try {
            await saveReportToQueue(
                cleanDescription,
                photos.map(photo => photo.uri).filter((uri): uri is string => Boolean(uri)),
            );
            setDescription('');
            setPhotos([]);
            showSuccessToast('Report saved on this device', 'It will upload automatically when a connection is available.');
        } catch (error) {
            showErrorToast('Could not save report', getErrorMessage(error));
        } finally {
            setBusy(false);
        }
    };



    return (
        <View style={styles.card}>
            <AppText variant="h2">New report</AppText>
            <AppText color={defaultTheme.colors.textSecondary}>Saved on this device first. Upload can continue when you leave the app.</AppText>
            <TextInput
                accessibilityLabel="Report description"
                value={description}
                onChangeText={setDescription}
                placeholder="What did you find?"
                placeholderTextColor={defaultTheme.colors.textSecondary}
                maxLength={MAX_REPORT_DESCRIPTION_LENGTH}
                multiline
                textAlignVertical="top"
                style={styles.description}
                editable={!busy}
            />
            <AppText variant="caption" color={defaultTheme.colors.textSecondary}>
                {description.length}/{MAX_REPORT_DESCRIPTION_LENGTH} characters - {photos.length}/{MAX_REPORT_IMAGES} photos
            </AppText>
            <View style={styles.actions}>
                <AppButton
                    title="Choose photos"
                    variant="outline"
                    onPress={pickFromGallery}
                    disabled={busy || photos.length >= MAX_REPORT_IMAGES}
                    style={styles.actionButton}
                />
                <AppButton
                    title="Take photo"
                    variant="outline"
                    onPress={takePhoto}
                    disabled={busy || photos.length >= MAX_REPORT_IMAGES}
                    style={styles.actionButton}
                />
            </View>
            {photos.length > 0 ? (
                <View style={styles.photoList}>
                    {photos.map((photo, index) => (
                        <View key={photo.uri ?? `selected-photo-${index}`} style={styles.photoItem}>
                            <Image source={{ uri: photo.uri }} style={styles.preview} resizeMode="cover" />
                            <AppText variant="caption">Photo {index + 1}</AppText>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`Remove photo ${index + 1}`}
                                onPress={() => setPhotos(current => current.filter((_, photoIndex) => photoIndex !== index))}
                                disabled={busy}
                                hitSlop={8}
                            >
                                <AppText color={defaultTheme.colors.error}>Remove</AppText>
                            </Pressable>
                        </View>
                    ))}
                </View>
            ) : (
                <AppText variant="caption" color={defaultTheme.colors.textSecondary}>
                    Add at least one photo. Large originals are resized on the device to stay under 5 MB.
                </AppText>
            )}
            <AppButton title="Save report" onPress={handleSaveReport} loading={busy} disabled={busy || !description.trim() || photos.length === 0} />
        </View>
    );
};

const styles = StyleSheet.create({
    card: {
        gap: defaultTheme.spacing.sm,
        padding: defaultTheme.spacing.md,
        borderRadius: defaultTheme.radius.md,
        backgroundColor: defaultTheme.colors.surface,
        marginBottom: defaultTheme.spacing.lg,
    },
    description: {
        minHeight: 100,
        paddingHorizontal: defaultTheme.spacing.md,
        paddingVertical: defaultTheme.spacing.sm,
        borderWidth: 1,
        borderColor: defaultTheme.colors.border,
        borderRadius: defaultTheme.radius.sm,
        color: defaultTheme.colors.text,
        backgroundColor: defaultTheme.colors.background,
    },
    actions: { flexDirection: 'row', gap: defaultTheme.spacing.sm },
    actionButton: { flex: 1, paddingHorizontal: defaultTheme.spacing.sm },
    photoList: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: defaultTheme.spacing.sm,
    },
    photoItem: {
        width: 78,
        alignItems: 'center',
        gap: defaultTheme.spacing.xs,
    },
    preview: { width: 72, height: 72, borderRadius: defaultTheme.radius.sm },
});

export default ReportComposer;
