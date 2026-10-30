import type { TextStyle } from 'react-native';
import type { colors } from './colors';

export type ThemeMode = 'light' | 'dark';

export type AppColors = typeof colors;

export type TypographyVariant = 'h1' | 'h2' | 'title' | 'body' | 'caption' | 'button';

export type AppTypography = Record<TypographyVariant, TextStyle>;

export interface AppTheme {
    colors: AppColors;
    typography: AppTypography;
    spacing: { xs: number; sm: number; md: number; lg: number; xl: number };
    radius: { sm: number; md: number; lg: number; pill: number };
}
