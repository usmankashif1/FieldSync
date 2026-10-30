import React from 'react';
import { StyleSheet, View } from 'react-native';
import AppText from '../../../components/AppText';
import { defaultTheme } from '../../../core/theme/defaultTheme';
import type { HomeItem } from '../home.types';

const HomeListItem = ({ item }: { item: HomeItem }) => {
    return (
        <View style={styles.card}>
            <AppText variant="title">{item.title}</AppText>
            {item.subtitle ? (
                <AppText variant="caption" color={defaultTheme.colors.textSecondary}>
                    {item.subtitle}
                </AppText>
            ) : null}
        </View>
    );
};

const styles = StyleSheet.create({
    card: {
        backgroundColor: defaultTheme.colors.surface,
        borderRadius: defaultTheme.radius.md,
        padding: defaultTheme.spacing.md,
        gap: defaultTheme.spacing.xs,
    },
});

export default HomeListItem;
