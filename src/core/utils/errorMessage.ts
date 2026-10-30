import { ApiError } from '../api/apiError';

export const getErrorMessage = (error: unknown, fallback = 'Something went wrong'): string => {
    if (error instanceof ApiError) return error.message || fallback;
    if (error instanceof Error) return error.message || fallback;
    if (typeof error === 'string') return error;
    return fallback;
};
