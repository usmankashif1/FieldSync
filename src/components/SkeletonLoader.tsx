import React from 'react';
import { StyleSheet, View } from 'react-native';
import { defaultTheme } from '../core/theme/defaultTheme';
import { RH } from '../core/utils/responsive';
import SkeletonBox from './SkeletonBox';

interface SkeletonLoaderProps {
    /** While true the skeleton is shown, when false `children` is rendered. */
    loading: boolean;
    /** How many placeholder items to render. */
    count?: number;
    /** Height of the default placeholder item. */
    itemHeight?: number;
    /** Custom placeholder for each item, e.g. `<MyCardSkeleton key={index} />`. */
    renderSkeleton?: (index: number) => React.ReactNode;
    children?: React.ReactNode;
}

/**
 * Wrap anything that depends on fetched data:
 *   <SkeletonLoader loading={isLoading} count={5} renderSkeleton={i => <ItemSkeleton key={i} />}>
 *       <List />
 *   </SkeletonLoader>
 */
const SkeletonLoader = ({ loading, count = 3, itemHeight = RH(72), renderSkeleton, children }: SkeletonLoaderProps) => {
    if (!loading) return <>{children}</>;

    return (
        <View style={styles.list}>
            {Array.from({ length: count }, (_, index) =>
                renderSkeleton ? (
                    <React.Fragment key={index}>{renderSkeleton(index)}</React.Fragment>
                ) : (
                    <SkeletonBox key={index} height={itemHeight} borderRadius={defaultTheme.radius.md} />
                ),
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    list: { gap: defaultTheme.spacing.sm },
});

export default SkeletonLoader;
