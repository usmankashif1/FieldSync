import React from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { defaultTheme } from '../core/theme/defaultTheme';

interface ScreenProps {
    children: React.ReactNode;
    edges?: Edge[];
    style?: StyleProp<ViewStyle>;
}

const Screen = ({ children, edges = ['top', 'bottom'], style }: ScreenProps) => {
    return (
        <SafeAreaView edges={edges} style={[styles.screen, style]}>
            {children}
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: defaultTheme.colors.background,
    },
});

export default Screen;
