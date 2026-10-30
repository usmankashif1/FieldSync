import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { defaultTheme } from '../core/theme/defaultTheme';
import { RH } from '../core/utils/responsive';
import AppText from './AppText';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'text';

interface AppButtonProps {
    title: string;
    onPress: () => void;
    variant?: ButtonVariant;
    loading?: boolean;
    disabled?: boolean;
    style?: StyleProp<ViewStyle>;
}

const { colors, radius, spacing } = defaultTheme;

const AppButton = ({ title, onPress, variant = 'primary', loading = false, disabled = false, style }: AppButtonProps) => {
    const isDisabled = disabled || loading;
    const textColor = variant === 'primary' ? colors.primaryText : colors.primary;

    return (
        <Pressable
            onPress={onPress}
            disabled={isDisabled}
            accessibilityRole="button"
            style={({ pressed }) => [
                styles.base,
                variantStyles[variant],
                pressed && styles.pressed,
                isDisabled && styles.disabled,
                style,
            ]}>
            {loading ? (
                <ActivityIndicator color={textColor} />
            ) : (
                <AppText variant="button" color={textColor}>
                    {title}
                </AppText>
            )}
        </Pressable>
    );
};

const styles = StyleSheet.create({
    base: {
        minHeight: RH(50),
        paddingHorizontal: spacing.lg,
        borderRadius: radius.md,
        alignItems: 'center',
        justifyContent: 'center',
    },
    pressed: { opacity: 0.85 },
    disabled: { opacity: 0.5 },
});

const variantStyles = StyleSheet.create({
    primary: { backgroundColor: colors.primary },
    secondary: { backgroundColor: colors.surface },
    outline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.primary },
    text: { backgroundColor: 'transparent' },
});

export default AppButton;
