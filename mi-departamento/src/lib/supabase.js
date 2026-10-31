import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/** Solo se usa la clave pública (publishable/anon). La seguridad real la dan las políticas RLS. */
export const configError = !url || !key
  ? 'Faltan VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY. Copiá .env.example a .env.local y completalo.'
  : null;

export const supabase = configError ? null : createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
