import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, RefreshControl, StyleSheet, View, type ListRenderItem } from 'react-native';
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
import type { Report } from '../../../core/queue/types';
import type { HomeItem } from '../home.types';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNetInfo } from '@react-native-community/netinfo';

const ServerItemSeparator = () => <View style={styles.separator} />;
const keyExtractor = (item: HomeItem) => item.id;

const HomeScreen = () => {
    const { items, loading, error, reload } = useHomeItems();
    const netInfo = useNetInfo();
    const [queue, setQueue] = useState<Report[]>([]);
    const refreshedReports = useRef(new Set<string>());
    const isOffline = netInfo.isConnected === false || netInfo.isInternetReachable === false;
    const displayedServerError = error
        ? 'Please try again in a moment. Check your internet connection if the problem continues.'
        : null;

    const renderServerItem = useCallback<ListRenderItem<HomeItem>>(
        ({ item }) => <HomeListItem item={item} />,
        [],
    );

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
        const newlySyncedReports = queue.filter(report => report.status === 'uploaded' && !refreshedReports.current.has(report.id));
        queue.forEach(report => {
            if (report.status === 'uploaded') {
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
            {isOffline ? (
                <View style={styles.offlineNotice}>
                    <AppText variant="title" color={defaultTheme.colors.error}>
                        No internet connection
                    </AppText>
                    <AppText color={defaultTheme.colors.textSecondary}>
                        Reports are saved on this device and will upload when you are back online.
                    </AppText>
                </View>
            ) : null}
            <ReportComposer />
            <View style={styles.sectionHeading}>
                <View style={styles.sectionTitle}>
                    <AppText variant="h2">On this device</AppText>
                </View>
                <AppButton title="Clear" variant="text" onPress={confirmClearHistory} disabled={queue.length === 0} />
            </View>
            {queue.length === 0 ? (
                <AppText style={styles.emptyQueue} color={defaultTheme.colors.textSecondary}>
                    No reports saved on this device.
                </AppText>
            ) : (
                [...queue].sort((newer, older) => older.createdAt - newer.createdAt).map(report => <ReportQueueCard key={report.id} report={report} />)
            )}
            <View style={styles.serverHeading}>
                <AppText variant="h2">Received by server</AppText>
            </View>
            {isOffline ? (
                <View style={styles.serverNotice}>
                    <AppText color={defaultTheme.colors.textSecondary}>
                        Server reports can't be loaded while you're offline.
                    </AppText>
                </View>
            ) : error ? (
                <View style={styles.serverError}>
                    <View style={styles.serverErrorText}>
                        <AppText variant="title" color={defaultTheme.colors.error}>
                            Couldn't load server reports
                        </AppText>
                        <AppText color={defaultTheme.colors.textSecondary}>{displayedServerError}</AppText>
                    </View>
                    <AppButton title="Retry" variant="text" onPress={reload} disabled={loading} />
                </View>
            ) : null}
        </View>
    );

    return (
        <SafeAreaView style={styles.list}>
            <FlatList
                style={styles.list}
                contentContainerStyle={styles.content}
                data={items}
                keyExtractor={keyExtractor}
                renderItem={renderServerItem}
                ItemSeparatorComponent={ServerItemSeparator}
                ListHeaderComponent={header}
                ListEmptyComponent={
                    loading ? (
                        <ActivityIndicator style={styles.emptyServer} color={defaultTheme.colors.primary} />
                    ) : error || isOffline ? undefined : (
                        <AppText style={styles.emptyServer} align="center" color={defaultTheme.colors.textSecondary}>
                            No reports have reached the server yet.
                        </AppText>
                    )
                }
                refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}
            />
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    list: { flex: 1, backgroundColor: defaultTheme.colors.background },
    content: {
        flexGrow: 1,
        paddingHorizontal: defaultTheme.spacing.md,
        paddingBottom: defaultTheme.spacing.xl,
    },
    sectionHeading: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: defaultTheme.spacing.sm,
        marginBottom: defaultTheme.spacing.md,
    },
    offlineNotice: {
        gap: defaultTheme.spacing.xs,
        marginBottom: defaultTheme.spacing.md,
        padding: defaultTheme.spacing.md,
        borderWidth: 1,
        borderColor: defaultTheme.colors.error,
        borderRadius: defaultTheme.radius.md,
        backgroundColor: defaultTheme.colors.surface,
    },
    sectionTitle: { flex: 1, gap: defaultTheme.spacing.xs },
    emptyQueue: { paddingVertical: defaultTheme.spacing.md },
    serverHeading: {
        gap: defaultTheme.spacing.xs,
        marginTop: defaultTheme.spacing.lg,
        marginBottom: defaultTheme.spacing.md,
    },
    serverNotice: {
        marginBottom: defaultTheme.spacing.md,
        padding: defaultTheme.spacing.md,
        borderRadius: defaultTheme.radius.md,
        backgroundColor: defaultTheme.colors.surface,
    },
    serverError: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: defaultTheme.spacing.sm,
        marginBottom: defaultTheme.spacing.md,
        padding: defaultTheme.spacing.md,
        borderWidth: 1,
        borderColor: defaultTheme.colors.error,
        borderRadius: defaultTheme.radius.md,
        backgroundColor: defaultTheme.colors.surface,
    },
    serverErrorText: { flex: 1, gap: defaultTheme.spacing.xs },
    separator: { height: defaultTheme.spacing.sm },
    emptyServer: { paddingVertical: defaultTheme.spacing.xl },
});

export default HomeScreen;
