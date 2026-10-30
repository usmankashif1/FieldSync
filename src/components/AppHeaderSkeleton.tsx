import React from 'react';
import { StyleSheet, View } from 'react-native';
import { defaultTheme } from '../core/theme/defaultTheme';
import { RH, RW } from '../core/utils/responsive';
import SkeletonBox from './SkeletonBox';

const AppHeaderSkeleton = () => {
    return (
        <View style={styles.row}>
            <SkeletonBox width={RW(32)} height={RW(32)} borderRadius={RW(16)} />
            <SkeletonBox width={RW(140)} height={RH(18)} />
            <SkeletonBox width={RW(32)} height={RW(32)} borderRadius={RW(16)} />
        </View>
    );
};

const styles = StyleSheet.create({
    row: {
        height: RH(56),
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: defaultTheme.spacing.md,
    },
});

export default AppHeaderSkeleton;
