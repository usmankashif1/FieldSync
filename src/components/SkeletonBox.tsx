import React, { useEffect, useRef } from 'react';
import { Animated, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import { defaultTheme } from '../core/theme/defaultTheme';
import { RH } from '../core/utils/responsive';

interface SkeletonBoxProps {
    width?: DimensionValue;
    height?: number;
    borderRadius?: number;
    style?: StyleProp<ViewStyle>;
}

/**
 * Base building block for every skeleton in the app.
 * Pulses between two tones so the placeholder feels alive.
 */
const SkeletonBox = ({ width = '100%', height = RH(16), borderRadius = defaultTheme.radius.sm, style }: SkeletonBoxProps) => {
    const opacity = useRef(new Animated.Value(0.5)).current;

    useEffect(() => {
        const loop = Animated.loop(
            Animated.sequence([
                Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
                Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
            ]),
        );
        loop.start();
        return () => loop.stop();
    }, [opacity]);

    return (
        <Animated.View
            style={[{ width, height, borderRadius, backgroundColor: defaultTheme.colors.skeleton, opacity }, style]}
        />
    );
};

export default SkeletonBox;
