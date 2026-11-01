import React from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';
import AppText from '../../../components/AppText';
import { defaultTheme } from '../../../core/theme/defaultTheme';
import type { Report } from '../../../core/queue/types';

const reportStatusLabel: Record<Report['status'], string> = {
    queued: 'Saved - waiting for connection',
    preparing: 'Preparing photos',
    waiting: 'Waiting for connection',
    uploading: 'Uploading to server',
    failed_retryable: 'Connection interrupted - will retry',
    failed_permanent: 'Needs attention',
    uploaded: 'Uploaded to server',
};

const imageStatusLabel: Record<Report['images'][number]['status'], string> = {
    pending: 'Waiting',
    uploading: 'Uploading',
    uploaded: 'Uploaded',
    failed: 'Not uploaded yet',
};

interface ReportQueueCardProps {
    report: Report;
}

const ReportQueueCard = ({ report }: ReportQueueCardProps) => {
    const uploadedImages = report.images.filter(image => image.status === 'uploaded').length;
    const isFailure = report.status === 'failed_retryable' || report.status === 'failed_permanent';
    const reportErrorIsShownOnImage = report.images.some(image => image.error === report.lastError);

    return (
        <View style={[styles.card, isFailure && styles.failedCard]}>
            <View style={styles.heading}>
                <View style={styles.title}>
                    <AppText variant="title">{report.description}</AppText>
                    <AppText color={isFailure ? defaultTheme.colors.error : defaultTheme.colors.textSecondary}>{reportStatusLabel[report.status]}</AppText>
                </View>
                {report.status === 'uploading' || report.status === 'preparing' ? <ActivityIndicator color={defaultTheme.colors.primary} /> : null}
            </View>
            <AppText variant="caption" color={defaultTheme.colors.textSecondary}>
                {uploadedImages}/{report.images.length} photos uploaded.
            </AppText>
            {report.lastError && !reportErrorIsShownOnImage ? (
                <AppText color={defaultTheme.colors.error} numberOfLines={2}>
                    {report.lastError}
                </AppText>
            ) : null}
            <View style={styles.images}>
                {report.images.map((image, index) => (
                    <View key={`${report.id}-${index}`} style={styles.imageRow}>
                        {image.compressedUri || image.localUri ? (
                            <Image
                                source={{
                                    uri: image.compressedUri ?? image.localUri,
                                }}
                                style={styles.thumbnail}
                                resizeMode="cover"
                            />
                        ) : (
                            <View style={[styles.thumbnail, styles.emptyThumbnail]} />
                        )}
                        <View style={styles.imageInfo}>
                            <AppText>Photo {index + 1}</AppText>
                            <AppText variant="caption" color={image.status === 'failed' ? defaultTheme.colors.error : defaultTheme.colors.textSecondary}>
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
    heading: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: defaultTheme.spacing.sm,
    },
    title: { flex: 1, gap: defaultTheme.spacing.xs },
    images: { gap: defaultTheme.spacing.sm },
    imageRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: defaultTheme.spacing.sm,
    },
    thumbnail: { width: 48, height: 48, borderRadius: defaultTheme.radius.sm },
    emptyThumbnail: { backgroundColor: defaultTheme.colors.border },
    imageInfo: { flex: 1, gap: defaultTheme.spacing.xs },
});

export default ReportQueueCard;
