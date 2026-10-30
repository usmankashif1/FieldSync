import { RS } from '../utils/responsive';
import { colors } from './colors';
import { typography } from './typography';
import type { AppTheme } from './themeTypes';

export const defaultTheme: AppTheme = {
    colors,
    typography,
    spacing: { xs: RS(4), sm: RS(8), md: RS(16), lg: RS(24), xl: RS(32) },
    radius: { sm: RS(6), md: RS(12), lg: RS(20), pill: 999 },
};
