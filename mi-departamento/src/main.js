import { supabase, configError } from './lib/supabase.js';
import * as gate from './gate.js';
import { Store } from './store.js';
import { startApp } from './app.js';

let started = false;

async function enter() {
  gate.showLoading('Cargando tu hogar…');
  try {
    const hasHome = await Store.load();
    if (!hasHome) return gate.showOnboarding();
    if (!started) { started = true; startApp(); }
    gate.hide();
  } catch (err) {
    console.error(err);
    gate.showError(err, enter);
  }
}

async function boot() {
  gate.init({ onSignedIn: enter });
  if (configError) return gate.showConfigError(configError);
  // Solo se registra el estado de sesión; no se hacen llamadas a Supabase dentro del callback.
  supabase.auth.onAuthStateChange(event => {
    if (event === 'PASSWORD_RECOVERY') gate.showReset();
    if (event === 'SIGNED_OUT') location.reload();
  });
  gate.showLoading();
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (!data.session) return gate.showAuth('login');
    // Si volvemos desde el enlace de recuperación, onAuthStateChange mostrará el formulario de nueva contraseña.
    if (location.hash.includes('type=recovery')) return;
    await enter();
  } catch (err) { gate.showError(err, boot); }
}
boot();
