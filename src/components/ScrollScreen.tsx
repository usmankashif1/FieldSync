import React from 'react';
import { ScrollView, StyleSheet, type RefreshControlProps, type StyleProp, type ViewStyle } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';
import { defaultTheme } from '../core/theme/defaultTheme';
import Screen from './Screen';

interface ScrollScreenProps {
    children: React.ReactNode;
    edges?: Edge[];
    refreshControl?: React.ReactElement<RefreshControlProps>;
    contentContainerStyle?: StyleProp<ViewStyle>;
}

const ScrollScreen = ({ children, edges, refreshControl, contentContainerStyle }: ScrollScreenProps) => {
    return (
        <Screen edges={edges}>
            <ScrollView
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                refreshControl={refreshControl}
                contentContainerStyle={[styles.content, contentContainerStyle]}>
                {children}
            </ScrollView>
        </Screen>
    );
};

const styles = StyleSheet.create({
    content: {
        flexGrow: 1,
        padding: defaultTheme.spacing.md,
    },
});

export default ScrollScreen;
