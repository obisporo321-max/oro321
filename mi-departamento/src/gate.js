/* Pantallas previas a la app: acceso, recuperación de contraseña y alta/unión a un hogar. */
import * as Auth from './services/auth.js';
import * as Homes from './services/households.js';
import { friendlyError } from './lib/errors.js';

let handlers = { onSignedIn: () => {} };
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const init = h => { handlers = h; };

function show(html) {
  const g = $('#gate'); g.hidden = false; document.body.classList.add('lock');
  g.innerHTML = `<div class="gate-card card fade">${html}<p id="gateMsg" class="note warn" role="alert" hidden style="margin-top:14px"></p></div>`;
  const first = g.querySelector('input'); if (first) first.focus({ preventScroll: true });
}
export function hide() { const g = $('#gate'); g.hidden = true; g.innerHTML = ''; document.body.classList.remove('lock'); }
function msg(text, bad = true) { const m = $('#gateMsg'); if (!m) return; m.textContent = text; m.className = 'note' + (bad ? ' warn' : ''); m.hidden = !text; }
async function submit(form, fn) {
  const btns = [...form.querySelectorAll('button')]; btns.forEach(b => b.disabled = true); msg('');
  try { await fn(new FormData(form)); } catch (e) { console.error(e); msg(friendlyError(e)); } finally { btns.forEach(b => b.disabled = false); }
}
const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
const val = (fd, k) => String(fd.get(k) || '').trim();

export function showLoading(text = 'Cargando…') { show(`<div class="empty"><div class="big" aria-hidden="true">🏢</div><p>${esc(text)}</p></div>`); }
export function showError(err, retry) {
  show(`<h1>No pudimos cargar tus datos</h1><p class="sub">${esc(friendlyError(err))}</p><button class="btn block" id="gRetry">Reintentar</button><button class="link" id="gOut">Cerrar sesión</button>`);
  on('#gRetry', 'click', retry); on('#gOut', 'click', () => Auth.signOut());
}
export function showConfigError(text) { show(`<h1>Falta la configuración</h1><p class="sub">${esc(text)}</p>`); }

export function showAuth(mode = 'login') {
  const signup = mode === 'signup';
  show(`<div class="brand" style="margin-bottom:14px"><span class="logo" aria-hidden="true">🏢</span><span>Mi Departamento</span></div>
    <h1>${signup ? 'Crear cuenta' : 'Iniciar sesión'}</h1><p class="sub">${signup ? 'Usá tu correo real: lo vas a necesitar para confirmar la cuenta.' : 'Entrá con tu cuenta para ver el departamento.'}</p>
    <form id="gForm" novalidate>
      <label class="field"><span>Correo electrónico</span><input type="text" name="email" inputmode="email" autocomplete="email" autocapitalize="off"></label>
      <label class="field"><span>Contraseña</span><input type="password" name="password" autocomplete="${signup ? 'new-password' : 'current-password'}" style="width:100%;min-height:48px;padding:10px 14px;border-radius:14px;border:1.5px solid var(--border);background:var(--bg);font-size:16px"></label>
      ${signup ? '<label class="field"><span>Repetir contraseña</span><input type="password" name="password2" autocomplete="new-password" style="width:100%;min-height:48px;padding:10px 14px;border-radius:14px;border:1.5px solid var(--border);background:var(--bg);font-size:16px"></label>' : ''}
      <button class="btn block" type="submit">${signup ? 'Crear cuenta' : 'Entrar'}</button></form>
    <div class="stack" style="gap:2px;margin-top:10px"><button class="link" id="gSwitch">${signup ? 'Ya tengo cuenta' : 'Crear una cuenta'}</button>${signup ? '' : '<button class="link" id="gForgot">Olvidé mi contraseña</button>'}</div>`);
  on('#gSwitch', 'click', () => showAuth(signup ? 'login' : 'signup')); on('#gForgot', 'click', showForgot);
  on('#gForm', 'submit', e => { e.preventDefault(); submit(e.target, async fd => {
    const email = val(fd, 'email').toLowerCase(), pw = String(fd.get('password') || '');
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Ingresá un correo válido.');
    if (pw.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
    if (signup) {
      if (pw !== String(fd.get('password2') || '')) throw new Error('Las contraseñas no coinciden.');
      const { session } = await Auth.signUp(email, pw);
      if (session) return handlers.onSignedIn();
      return msg('Te enviamos un correo para confirmar la cuenta. Después de confirmarlo, iniciá sesión.', false);
    }
    await Auth.signIn(email, pw); handlers.onSignedIn();
  }); });
}

export function showForgot() {
  show(`<h1>Recuperar contraseña</h1><p class="sub">Te enviamos un enlace para elegir una nueva.</p>
    <form id="gForm" novalidate><label class="field"><span>Correo electrónico</span><input type="text" name="email" inputmode="email" autocomplete="email"></label>
    <button class="btn block" type="submit">Enviar enlace</button></form><button class="link" id="gBack">← Volver</button>`);
  on('#gBack', 'click', () => showAuth('login'));
  on('#gForm', 'submit', e => { e.preventDefault(); submit(e.target, async fd => {
    const email = val(fd, 'email').toLowerCase(); if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Ingresá un correo válido.');
    await Auth.resetPassword(email); msg('Si el correo existe, te llegará un enlace en unos minutos.', false);
  }); });
}

export function showReset() {
  const st = 'width:100%;min-height:48px;padding:10px 14px;border-radius:14px;border:1.5px solid var(--border);background:var(--bg);font-size:16px';
  show(`<h1>Elegí una nueva contraseña</h1><form id="gForm" novalidate>
    <label class="field"><span>Nueva contraseña</span><input type="password" name="password" autocomplete="new-password" style="${st}"></label>
    <label class="field"><span>Repetirla</span><input type="password" name="password2" autocomplete="new-password" style="${st}"></label>
    <button class="btn block" type="submit">Guardar contraseña</button></form>`);
  on('#gForm', 'submit', e => { e.preventDefault(); submit(e.target, async fd => {
    const pw = String(fd.get('password') || ''); if (pw.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
    if (pw !== String(fd.get('password2') || '')) throw new Error('Las contraseñas no coinciden.');
    await Auth.updatePassword(pw); handlers.onSignedIn();
  }); });
}

/* Usuario autenticado pero sin hogar: el acceso solo se obtiene creando uno propio o con un código de invitación vigente. */
export function showOnboarding() {
  show(`<h1>Tu hogar</h1><p class="sub">Todavía no estás en ningún hogar. Creá uno nuevo o unite con el código que te dio la otra persona.</p>
    <form id="gCreate" novalidate><h2 style="font-size:1.05rem;margin-bottom:10px">🏠 Crear el hogar</h2>
      <label class="field"><span>Nombre del hogar</span><input type="text" name="home" value="Mi Departamento" maxlength="60"></label>
      <label class="field"><span>Tu nombre</span><input type="text" name="me" maxlength="40" placeholder="Ej.: Mateo"></label>
      <button class="btn block" type="submit">Crear hogar</button></form>
    <hr style="border:0;border-top:1px solid var(--border);margin:20px 0">
    <form id="gJoin" novalidate><h2 style="font-size:1.05rem;margin-bottom:10px">🔑 Unirme con un código</h2>
      <label class="field"><span>Código de invitación</span><input type="text" name="code" maxlength="20" autocapitalize="characters" autocomplete="off"></label>
      <label class="field"><span>Tu nombre</span><input type="text" name="me" maxlength="40" placeholder="Ej.: Salma"></label>
      <button class="btn block ghost" type="submit">Unirme</button></form>
    <button class="link" id="gOut" style="margin-top:12px">Cerrar sesión</button>`);
  on('#gOut', 'click', () => Auth.signOut());
  on('#gCreate', 'submit', e => { e.preventDefault(); submit(e.target, async fd => {
    if (!val(fd, 'me')) throw new Error('Escribí tu nombre.'); await Homes.create(val(fd, 'home'), val(fd, 'me')); handlers.onSignedIn();
  }); });
  on('#gJoin', 'submit', e => { e.preventDefault(); submit(e.target, async fd => {
    if (!val(fd, 'code')) throw new Error('Ingresá el código de invitación.'); if (!val(fd, 'me')) throw new Error('Escribí tu nombre.');
    await Homes.joinWithCode(val(fd, 'code'), val(fd, 'me')); handlers.onSignedIn();
  }); });
}
