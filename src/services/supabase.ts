import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { mmkv } from '../utils/storage';

const mmkvAuthStorage = {
  getItem: (key: string) => mmkv.getString(key) ?? null,
  setItem: (key: string, value: string) => mmkv.set(key, value),
  removeItem: (key: string) => {
    if (typeof (mmkv as any).delete === 'function') {
      (mmkv as any).delete(key);
    } else if (typeof (mmkv as any).remove === 'function') {
      (mmkv as any).remove(key);
    }
  },
};

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() || 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() || 'placeholder';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: mmkvAuthStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
