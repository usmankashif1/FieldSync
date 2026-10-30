import { useCallback, useEffect, useState } from 'react';
import { getErrorMessage } from '../../../core/utils/errorMessage';
import { fetchHomeItems } from '../home.api';
import type { HomeItem } from '../home.types';

export const useHomeItems = () => {
    const [items, setItems] = useState<HomeItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            setItems(await fetchHomeItems());
        } catch (e) {
            setError(getErrorMessage(e));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    return { items, loading, error, reload: load };
};
