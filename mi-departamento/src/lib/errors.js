/** Traduce errores de Supabase/PostgREST/red a mensajes comprensibles. */
export function friendlyError(err) {
  const m = String(err?.message || err || '');
  const code = err?.code || '';
  if (/Invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
  if (/Email not confirmed/i.test(m)) return 'Todavía no confirmaste tu correo. Revisá tu bandeja de entrada.';
  if (/User already registered/i.test(m)) return 'Ya existe una cuenta con ese correo. Probá iniciar sesión.';
  if (/Password should be at least|weak/i.test(m)) return 'La contraseña es demasiado débil (mínimo 8 caracteres).';
  if (/rate limit|too many/i.test(m)) return 'Demasiados intentos. Esperá unos minutos y probá de nuevo.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Sin conexión con el servidor. Revisá tu internet.';
  if (/JWT expired|not authenticated|Auth session missing/i.test(m)) return 'Tu sesión venció. Volvé a iniciar sesión.';
  if (code === '23505') return 'Ya existe un registro con ese nombre.';
  if (/new row violates row-level security|permission denied/i.test(m)) return 'No tenés permiso para hacer esto.';
  if (/mime type|not allowed|exceeded the maximum/i.test(m)) return 'Archivo no admitido: usá PDF, JPG, PNG o WEBP de hasta 10 MB.';
  // Mensajes propios de la base (ya están en español)
  if (['P0001', '23514', '23503', '42501', '28000'].includes(code) && /[áéíóúñ ]/.test(m)) return m;
  return 'Ocurrió un error inesperado. Probá de nuevo.';
}
