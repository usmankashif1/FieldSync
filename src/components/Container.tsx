import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { defaultTheme } from '../core/theme/defaultTheme';

interface ContainerProps extends ViewProps {
    style?: StyleProp<ViewStyle>;
}

const Container = ({ style, children, ...rest }: ContainerProps) => {
    return (
        <View style={[styles.container, style]} {...rest}>
            {children}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        paddingHorizontal: defaultTheme.spacing.md,
    },
});

export default Container;
