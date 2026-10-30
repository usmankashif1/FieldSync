import axios from 'axios';
import { API_BASE_URL } from '../utils/config';
import { toApiError } from './apiError';

export const apiClient = axios.create({
    baseURL: API_BASE_URL,
    timeout: 15000,
    headers: { 'Content-Type': 'application/json' },
});

apiClient.interceptors.response.use(
    response => response,
    error => Promise.reject(toApiError(error)),
);
