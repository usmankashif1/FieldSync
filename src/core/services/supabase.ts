import { createClient } from '@supabase/supabase-js';
import Config from 'react-native-config';

const supabaseUrl = Config.SUPABASE_URL?.trim();
const supabaseKey = Config.SUPABASE_ANON_KEY?.trim();

if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase configuration. Set SUPABASE_URL and SUPABASE_ANON_KEY in .env.');
}

if (supabaseKey.startsWith('sb_secret_') || supabaseKey === 'service_role') {
    throw new Error('A Supabase secret/service-role key cannot be used in a mobile app. Use a publishable/anon key.');
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
    },
});

export const getSupabaseConfiguration = (): { url: string; anonKey: string } => ({
    url: supabaseUrl,
    anonKey: supabaseKey,
});