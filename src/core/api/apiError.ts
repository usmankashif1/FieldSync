import axios from 'axios';

export class ApiError extends Error {
    status?: number;
    data?: unknown;

    constructor(message: string, status?: number, data?: unknown) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.data = data;
    }
}

export const toApiError = (error: unknown): ApiError => {
    if (error instanceof ApiError) return error;

    if (axios.isAxiosError(error)) {
        const data = error.response?.data as { message?: string } | undefined;
        return new ApiError(
            data?.message ?? error.message ?? 'Network error',
            error.response?.status,
            error.response?.data,
        );
    }

    if (error instanceof Error) return new ApiError(error.message);
    return new ApiError('Unknown error');
};
