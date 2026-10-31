import React, { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    RefreshControl,
    StyleSheet,
    View,
} from 'react-native';
import AppButton from '../../../components/AppButton';
import AppHeader from '../../../components/AppHeader';
import AppText from '../../../components/AppText';
import { clearLocalQueue, getLocalQueue, subscribeToQueue } from '../../../core/services/queueEngine';
import { defaultTheme } from '../../../core/theme/defaultTheme';
import { getErrorMessage } from '../../../core/utils/errorMessage';
import { showErrorToast, showSuccessToast } from '../../../core/utils/toast';
import HomeListItem from '../components/HomeListItem';
import ReportComposer from '../components/ReportComposer';
import ReportQueueCard from '../components/ReportQueueCard';
import { useHomeItems } from '../hooks/useHomeItems';
import type { ReportItem } from '../home.types';

const ServerItemSeparator = () => <View style={styles.separator} />;

const HomeScreen = () => {
    const { items, loading, error, reload } = useHomeItems();
    const [queue, setQueue] = useState<ReportItem[]>([]);
    const refreshedReports = useRef(new Set<string>());

    useEffect(() => {
        let mounted = true;
        const unsubscribe = subscribeToQueue(reports => {
            if (mounted) {
                setQueue(reports);
            }
        });

        getLocalQueue()
            .then(reports => {
                if (mounted) {
                    setQueue(reports);
                }
            })
            .catch(queueError => {
                showErrorToast('Could not load saved reports', getErrorMessage(queueError));
            });

        return () => {
            mounted = false;
            unsubscribe();
        };
    }, []);

    useEffect(() => {
        const newlySyncedReports = queue.filter(
            report => report.status === 'synced' && !refreshedReports.current.has(report.id),
        );
        queue.forEach(report => {
            if (report.status === 'synced') {
                refreshedReports.current.add(report.id);
            }
        });

        if (newlySyncedReports.length > 0) {
            reload();
        }
    }, [queue, reload]);

    const confirmClearHistory = (): void => {
        if (queue.length === 0) {
            showSuccessToast('Nothing to clear', 'There are no locally saved reports.');
            return;
        }

        Alert.alert(
            'Clear local report history?',
            'This deletes reports saved on this device and their local photo copies. Any report that has not uploaded yet will be discarded. Reports already on the server are not deleted.',
            [
                { text: 'Keep reports', style: 'cancel' },
                {
                    text: 'Clear local history',
                    style: 'destructive',
                    onPress: () => {
                        clearLocalQueue()
                            .then(() => showSuccessToast('Local history cleared'))
                            .catch(clearError => showErrorToast('Could not clear local history', getErrorMessage(clearError)));
                    },
                },
            ],
        );
    };

    const header = (
        <View>
            <AppHeader title="Field reports" />
            <ReportComposer />
            <View style={styles.sectionHeading}>
                <View style={styles.sectionTitle}>
                    <AppText variant="h2">On this device</AppText>
                    <AppText variant="caption" color={defaultTheme.colors.textSecondary}>
                        Saved reports are safe offline. Upload status is shown separately from server history.
                    </AppText>
                </View>
                <AppButton
                    title="Clear"
                    variant="text"
                    onPress={confirmClearHistory}
                    disabled={queue.length === 0}
                />
            </View>
            {queue.length === 0 ? (
                <AppText style={styles.emptyQueue} color={defaultTheme.colors.textSecondary}>
                    No reports saved on this device.
                </AppText>
            ) : (
                [...queue]
                    .sort((newer, older) => older.createdAt - newer.createdAt)
                    .map(report => <ReportQueueCard key={report.id} report={report} />)
            )}
            <View style={styles.serverHeading}>
                <AppText variant="h2">Received by server</AppText>
                <AppText variant="caption" color={defaultTheme.colors.textSecondary}>
                    This list is fetched from Supabase; it is not the local upload queue.
                </AppText>
            </View>
        </View>
    );

    return (
        <FlatList
            style={styles.list}
            contentContainerStyle={styles.content}
            data={items}
            keyExtractor={item => item.id}
            renderItem={({ item }) => <HomeListItem item={item} />}
            ItemSeparatorComponent={ServerItemSeparator}
            ListHeaderComponent={header}
            ListEmptyComponent={
                loading ? (
                    <ActivityIndicator style={styles.emptyServer} color={defaultTheme.colors.primary} />
                ) : (
                    <AppText style={styles.emptyServer} align="center" color={error ? defaultTheme.colors.error : defaultTheme.colors.textSecondary}>
                        {error ?? 'No reports have reached the server yet.'}
                    </AppText>
                )
            }
            refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}
        />
    );
};

const styles = StyleSheet.create({
    list: { flex: 1, backgroundColor: defaultTheme.colors.background },
    content: { flexGrow: 1, paddingHorizontal: defaultTheme.spacing.md, paddingBottom: defaultTheme.spacing.xl },
    sectionHeading: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: defaultTheme.spacing.sm,
        marginBottom: defaultTheme.spacing.md,
    },
    sectionTitle: { flex: 1, gap: defaultTheme.spacing.xs },
    emptyQueue: { paddingVertical: defaultTheme.spacing.md },
    serverHeading: { gap: defaultTheme.spacing.xs, marginTop: defaultTheme.spacing.lg, marginBottom: defaultTheme.spacing.md },
    separator: { height: defaultTheme.spacing.sm },
    emptyServer: { paddingVertical: defaultTheme.spacing.xl },
});

export default HomeScreen;
