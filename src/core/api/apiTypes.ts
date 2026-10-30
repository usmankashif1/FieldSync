export interface ApiResponse<T> {
    success: boolean;
    message?: string;
    data: T;
}

export interface PaginatedResponse<T> {
    items: T[];
    page: number;
    pageSize: number;
    total: number;
}
