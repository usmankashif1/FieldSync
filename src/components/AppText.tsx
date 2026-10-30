import React from 'react';
import { StyleSheet, Text, type TextProps, type TextStyle } from 'react-native';
import { defaultTheme } from '../core/theme/defaultTheme';
import type { TypographyVariant } from '../core/theme/themeTypes';

interface AppTextProps extends TextProps {
    variant?: TypographyVariant;
    color?: string;
    align?: TextStyle['textAlign'];
}

const AppText = ({ variant = 'body', color, align, style, children, ...rest }: AppTextProps) => {
    return (
        <Text
            style={[
                styles.base,
                defaultTheme.typography[variant],
                color ? { color } : null,
                align ? { textAlign: align } : null,
                style,
            ]}
            {...rest}>
            {children}
        </Text>
    );
};

const styles = StyleSheet.create({
    base: {
        color: defaultTheme.colors.text,
    },
});

export default AppText;
