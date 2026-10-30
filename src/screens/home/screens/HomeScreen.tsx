import React from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import AppHeader from '../../../components/AppHeader';
import AppText from '../../../components/AppText';
import Screen from '../../../components/Screen';
import SkeletonLoader from '../../../components/SkeletonLoader';
import { defaultTheme } from '../../../core/theme/defaultTheme';
import HomeListItem from '../components/HomeListItem';
import HomeListItemSkeleton from '../components/HomeListItemSkeleton';
import { useHomeItems } from '../hooks/useHomeItems';

const Separator = () => <View style={styles.separator} />;

const HomeScreen = () => {
    const { items, loading, error, reload } = useHomeItems();

    return (
        <Screen>
            <AppHeader title="Home" />
            <View style={styles.body}>
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
});

export default HomeScreen;
