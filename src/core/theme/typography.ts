import { RF } from '../utils/responsive';
import type { AppTypography } from './themeTypes';

// Swap `fontFamily` for your custom fonts (e.g. Poppins) once they are loaded.
export const typography: AppTypography = {
    h1: { fontSize: RF(28), fontWeight: '700', lineHeight: RF(36) },
    h2: { fontSize: RF(22), fontWeight: '700', lineHeight: RF(30) },
    title: { fontSize: RF(18), fontWeight: '600', lineHeight: RF(26) },
    body: { fontSize: RF(15), fontWeight: '400', lineHeight: RF(22) },
    caption: { fontSize: RF(12), fontWeight: '400', lineHeight: RF(16) },
    button: { fontSize: RF(16), fontWeight: '600', lineHeight: RF(22) },
};
