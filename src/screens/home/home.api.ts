import { apiClient } from '../../core/api/apiClient';
import type { ApiResponse } from '../../core/api/apiTypes';
import { ENDPOINTS } from '../../core/api/endpoints';
import type { HomeItem } from './home.types';

export const fetchHomeItems = async (): Promise<HomeItem[]> => {
    const { data } = await apiClient.get<ApiResponse<HomeItem[]>>(ENDPOINTS.HOME.LIST);
    return data.data;
};
