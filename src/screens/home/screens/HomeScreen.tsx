import React, { useState } from 'react';
import { Alert, FlatList, Image, RefreshControl, StyleSheet, Text, View } from 'react-native';
import type { Asset } from 'react-native-image-picker';
import AppButton from '../../../components/AppButton';
import AppHeader from '../../../components/AppHeader';
import AppText from '../../../components/AppText';
import Screen from '../../../components/Screen';
import SkeletonLoader from '../../../components/SkeletonLoader';
import { openPermissionSettings, requestGalleryPermission } from '../../../core/permissions/permissionService';
import { defaultTheme } from '../../../core/theme/defaultTheme';
import { getErrorMessage } from '../../../core/utils/errorMessage';
import { showErrorToast, showInfoToast, showSuccessToast } from '../../../core/utils/toast';
import HomeListItem from '../components/HomeListItem';
import HomeListItemSkeleton from '../components/HomeListItemSkeleton';
import { useHomeItems } from '../hooks/useHomeItems';

const Separator = () => <View style={styles.separator} />;

const HomeScreen = () => {
    const { items, loading, error, reload } = useHomeItems();
    const [selectingImage, setSelectingImage] = useState(false);
    const [selectedImage, setSelectedImage] = useState<Asset | null>(null);
    const [image_url, setImage_url] = useState<string | null>(null);

    const handleUploadImage = async (): Promise<void> => {
        setSelectingImage(true);

        try {
            const permissionResult = await requestGalleryPermission();

            if (permissionResult === 'blocked') {
                Alert.alert(
                    'Photo access blocked',
                    'Enable photo access in Settings, then tap Upload image again.',
                    [
                        { text: 'Not now', style: 'cancel' },
                        {
                            text: 'Open Settings',
                            onPress: async () => {
                                try {
                                    await openPermissionSettings();
                                } catch (permissionError) {
                                    showErrorToast('Could not open Settings', getErrorMessage(permissionError));
                                }
                            },
                        },
                    ],
                );
                return;
            }

            if (permissionResult === 'denied') {
                showInfoToast('Photo access needed', 'Tap Upload image to try requesting permission again.');
                return;
            }

            if (permissionResult === 'unavailable') {
                showErrorToast('Photo access unavailable', 'This device does not support photo-library access.');
                return;
            }

            const { launchImageLibrary } = require('react-native-image-picker') as typeof import('react-native-image-picker');
            const pickerResponse = await launchImageLibrary({
                mediaType: 'photo',
                selectionLimit: 1,
                quality: 0.9,
            });

            if (pickerResponse.didCancel) {
                return;
            }

            if (pickerResponse.errorCode) {
                showErrorToast(
                    'Could not select an image',
                    pickerResponse.errorMessage ?? 'Please try selecting the image again.',
                );
                return;
            }

            const image = pickerResponse.assets?.[0];
            if (!image?.uri) {
                showErrorToast('Could not select an image', 'The selected image could not be opened.');
                return;
            }

            setSelectedImage(image);
            const { uploadSingleImage } = require('../../../core/services/uploadService') as typeof import('../../../core/services/uploadService');
            try {
                const image_url = await uploadSingleImage(image.uri, {
                    fileName: image.fileName,
                    mimeType: image.type,
                });
                setImage_url(image_url);
                console.log("uploaded image url:", image_url)

            } catch (uploadError) {
                showErrorToast('Image upload failed', getErrorMessage(uploadError));
                return;
            }

            showSuccessToast('Image uploaded', image.fileName ?? 'Your image is ready');
        } catch (permissionError) {
            showErrorToast('Could not select an image', getErrorMessage(permissionError));
        } finally {
            setSelectingImage(false);
        }
    };



    return (
        <Screen>
            <AppHeader title="Home" />
            <View style={styles.body}>
                <AppButton
                    title="Upload image"
                    onPress={handleUploadImage}
                    loading={selectingImage}
                    disabled={selectingImage}
                />
                <Text style={{ marginTop: 10, marginBottom: 10, color: defaultTheme.colors.textSecondary }}>
                    {image_url}
                </Text>
                {image_url ? (
                    <View style={styles.selectedImageContainer}>
                        <Image source={{ uri: image_url }} style={styles.selectedImage} resizeMode="cover" />
                    </View>
                ) : null}
                <SkeletonLoader loading={loading} count={6} renderSkeleton={index => <HomeListItemSkeleton key={index} />}>
                    <FlatList
                        data={items}
                        keyExtractor={item => item.id}
                        renderItem={({ item }) => <HomeListItem item={item} />}
                        ItemSeparatorComponent={Separator}
                        refreshControl={<RefreshControl refreshing={false} onRefresh={reload} />}
                        ListEmptyComponent={
                            <AppText align="center" color={defaultTheme.colors.textSecondary}>
                                {error ?? 'Nothing here yet'}
                            </AppText>
                        }
                    />
                </SkeletonLoader>
            </View>



        </Screen>
    );
};

const styles = StyleSheet.create({
    body: { flex: 1, paddingHorizontal: defaultTheme.spacing.md },
    separator: { height: defaultTheme.spacing.sm },
    selectedImageContainer: { gap: defaultTheme.spacing.sm },
    selectedImage: {
        width: '100%',
        height: 220,
        borderRadius: defaultTheme.radius.md,
        backgroundColor: defaultTheme.colors.surface,
    },
});

export default HomeScreen;
