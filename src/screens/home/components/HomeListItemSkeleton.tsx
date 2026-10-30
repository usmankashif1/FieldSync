import React from 'react';
import { StyleSheet, View } from 'react-native';
import SkeletonBox from '../../../components/SkeletonBox';
import { defaultTheme } from '../../../core/theme/defaultTheme';
import { RH, RW } from '../../../core/utils/responsive';

// Mirrors the layout of HomeListItem so nothing jumps when data arrives.
const HomeListItemSkeleton = () => {
    return (
        <View style={styles.card}>
            <SkeletonBox width={RW(180)} height={RH(18)} />
            <SkeletonBox width={RW(110)} height={RH(12)} />
        </View>
    );
};

const styles = StyleSheet.create({
    card: {
        backgroundColor: defaultTheme.colors.surface,
        borderRadius: defaultTheme.radius.md,
        padding: defaultTheme.spacing.md,
        gap: defaultTheme.spacing.sm,
    },
});

export default HomeListItemSkeleton;
