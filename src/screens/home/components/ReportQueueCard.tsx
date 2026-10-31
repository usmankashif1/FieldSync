import React, { useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';
import AppButton from '../../../components/AppButton';
import AppText from '../../../components/AppText';
import { defaultTheme } from '../../../core/theme/defaultTheme';
import { getErrorMessage } from '../../../core/utils/errorMessage';
import { showErrorToast, showSuccessToast } from '../../../core/utils/toast';
import { QueueSchedulingError, retryReport } from '../../../core/services/queueEngine';
import type { ImageStatus, ReportItem, ReportStatus } from '../home.types';

const reportStatusLabel: Record<ReportStatus, string> = {
    queued: 'Saved - waiting for connection',
    uploading: 'Uploading to server',
    retrying: 'Connection interrupted - will retry',
    synced: 'Uploaded to server',
    failed: 'Needs attention',
};

const imageStatusLabel: Record<ImageStatus, string> = {
    pending: 'Waiting',
    uploading: 'Uploading',
    completed: 'Uploaded',
    failed: 'Not uploaded yet',
};

interface ReportQueueCardProps {
    report: ReportItem;
}

const ReportQueueCard = ({ report }: ReportQueueCardProps) => {
    const [retrying, setRetrying] = useState(false);
    const uploadedImages = report.images.filter(image => image.status === 'completed').length;
    const isFailure = report.status === 'failed';

    const handleRetry = async (): Promise<void> => {
        setRetrying(true);
        try {
            await retryReport(report.id);
            showSuccessToast('Retry scheduled', 'The report is saved and will be tried again.');
        } catch (error) {
            showErrorToast(
                error instanceof QueueSchedulingError
                    ? 'Retry saved; upload needs attention'
                    : 'Could not retry report',
                getErrorMessage(error),
            );
        } finally {
            setRetrying(false);
        }
    };

    return (
        <View style={[styles.card, isFailure && styles.failedCard]}>
            <View style={styles.heading}>
                <View style={styles.title}>
                    <AppText variant="title">{report.description}</AppText>
                    <AppText color={isFailure ? defaultTheme.colors.error : defaultTheme.colors.textSecondary}>
                        {reportStatusLabel[report.status]}
                    </AppText>
                </View>
                {report.status === 'uploading' ? <ActivityIndicator color={defaultTheme.colors.primary} /> : null}
            </View>
            <AppText variant="caption" color={defaultTheme.colors.textSecondary}>
                Saved on this device.
            </AppText>
            <AppText variant="caption" color={defaultTheme.colors.textSecondary}>
                {uploadedImages}/{report.images.length} photos uploaded.
            </AppText>
            {report.error ? (
                <AppText color={defaultTheme.colors.error}>{report.error}</AppText>
            ) : null}
            <View style={styles.images}>
                {report.images.map((image, index) => (
                    <View key={`${report.id}-${index}`} style={styles.imageRow}>
                        {image.uri ? (
                            <Image source={{ uri: image.uri }} style={styles.thumbnail} resizeMode="cover" />
                        ) : (
                            <View style={[styles.thumbnail, styles.emptyThumbnail]} />
                        )}
                        <View style={styles.imageInfo}>
                            <AppText>Photo {index + 1}</AppText>
                            <AppText
                                variant="caption"
                                color={image.status === 'failed' ? defaultTheme.colors.error : defaultTheme.colors.textSecondary}>
                                {image.status === 'uploading' && typeof image.progress === 'number'
                                    ? `Uploading ${image.progress}%`
                                    : imageStatusLabel[image.status]}
                            </AppText>
                            {image.error ? (
                                <AppText variant="caption" color={defaultTheme.colors.error} numberOfLines={2}>
                                    {image.error}
                                </AppText>
                            ) : null}
                        </View>
                        {image.status === 'uploading' ? <ActivityIndicator size="small" /> : null}
                    </View>
                ))}
            </View>
            {isFailure ? (
                <AppButton
                    title="Try again"
                    variant="outline"
                    onPress={handleRetry}
                    loading={retrying}
                    disabled={retrying}
                />
            ) : null}
        </View>
    );
};

const styles = StyleSheet.create({
    card: {
        gap: defaultTheme.spacing.sm,
        padding: defaultTheme.spacing.md,
        marginBottom: defaultTheme.spacing.sm,
        borderRadius: defaultTheme.radius.md,
        backgroundColor: defaultTheme.colors.surface,
    },
    failedCard: { borderWidth: 1, borderColor: defaultTheme.colors.error },
    heading: { flexDirection: 'row', alignItems: 'center', gap: defaultTheme.spacing.sm },
    title: { flex: 1, gap: defaultTheme.spacing.xs },
    images: { gap: defaultTheme.spacing.sm },
    imageRow: { flexDirection: 'row', alignItems: 'center', gap: defaultTheme.spacing.sm },
    thumbnail: { width: 48, height: 48, borderRadius: defaultTheme.radius.sm },
    emptyThumbnail: { backgroundColor: defaultTheme.colors.border },
    imageInfo: { flex: 1, gap: defaultTheme.spacing.xs },
});

export default ReportQueueCard;
