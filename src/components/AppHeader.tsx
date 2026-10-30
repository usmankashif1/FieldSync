import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { defaultTheme } from '../core/theme/defaultTheme';
import { RH, RW } from '../core/utils/responsive';
import AppText from './AppText';

interface AppHeaderProps {
    title: string;
    onBackPress?: () => void;
    right?: React.ReactNode;
}

const AppHeader = ({ title, onBackPress, right }: AppHeaderProps) => {
    return (
        <View style={styles.row}>
            <View style={styles.side}>
                {onBackPress ? (
                    <Pressable onPress={onBackPress} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
                        <AppText variant="title">{'‹'}</AppText>
                    </Pressable>
                ) : null}
            </View>
            <AppText variant="title" style={styles.title} numberOfLines={1}>
                {title}
            </AppText>
            <View style={[styles.side, styles.right]}>{right}</View>
        </View>
    );
};

const styles = StyleSheet.create({
    row: {
        height: RH(56),
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: defaultTheme.spacing.md,
    },
    side: { width: RW(48), justifyContent: 'center' },
    right: { alignItems: 'flex-end' },
    title: { flex: 1, textAlign: 'center' },
});

export default AppHeader;
