import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { ThemeMode } from '../../core/theme/themeTypes';

interface ThemeState {
    mode: ThemeMode;
}

const initialState: ThemeState = { mode: 'light' };

const themeSlice = createSlice({
    name: 'theme',
    initialState,
    reducers: {
        setThemeMode: (state, action: PayloadAction<ThemeMode>) => {
            state.mode = action.payload;
        },
    },
});

export const { setThemeMode } = themeSlice.actions;
export default themeSlice.reducer;
