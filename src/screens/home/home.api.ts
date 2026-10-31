import { supabase } from '../../core/services/supabase';
import type { HomeItem } from './home.types';

export const fetchHomeItems = async (): Promise<HomeItem[]> => {
    const { data, error } = await supabase
        .from('reports')
        .select('id, description, image_urls, created_at')
        .order('created_at', { ascending: false });

    if (error) {
        throw new Error(`Could not load reports from the server: ${error.message}`);
    }

    return (data ?? []).map(report => ({
        id: report.id,
        description: report.description,
        image_urls: report.image_urls ?? [],
        created_at: report.created_at,
    }));
};
