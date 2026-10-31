import { Store, DEFAULT_SETTINGS } from './store.js';
import { friendlyError } from './lib/errors.js';
import * as Auth from './services/auth.js';
/* =====================================================================
   MI DEPARTAMENTO · Fase 2 (datos en Supabase)
   Bloques: 1) utilidades  2) capa de almacenamiento (reemplazable por Supabase)
            3) lógica de dominio  4) vistas  5) modales  6) eventos
   ===================================================================== */

/* ---------- 1. UTILIDADES ---------- */
const TZ = 'America/Argentina/Cordoba';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n || 0);
const todayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const dateObj = iso => new Date(iso + 'T12:00:00Z');
const addDays = (iso, n) => { const d = dateObj(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const monthKey = iso => iso.slice(0, 7);
const addMonths = (key, n) => { const [y, m] = key.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 15)); return d.toISOString().slice(0, 7); };
const fmtDate = iso => dateObj(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', timeZone: 'UTC' }).replace('.', '');
const fmtDateLong = iso => dateObj(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const periodLabel = key => cap(new Date(key + '-15T12:00:00Z').toLocaleDateString('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' }));
const monthShort = key => new Date(key + '-15T12:00:00Z').toLocaleDateString('es-AR', { month: 'short', timeZone: 'UTC' }).replace('.', '');
const norm = s => String(s).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const CATEGORIES = [
  { name: 'Alquiler', emoji: '🏠' }, { name: 'Electricidad', emoji: '💡' }, { name: 'Gas', emoji: '🔥' },
  { name: 'Agua', emoji: '💧' }, { name: 'Internet', emoji: '🌐' }, { name: 'Impuestos', emoji: '🏛️' },
  { name: 'Expensas', emoji: '🏢' }, { name: 'Otros', emoji: '📦' }
];
const PRODUCT_CATEGORIES = ['Higiene personal', 'Baño', 'Cocina', 'Limpieza', 'Alimentos', 'Otros'];
const EMOJI_CHOICES = ['🪥', '🧻', '🧴', '🧼', '🧽', '🧹', '🫧', '🧺', '🥛', '🍞', '🥚', '🍚', '☕', '🍝', '🥫', '🧂', '🍎', '🧃', '🛒', '📦'];
const PAY_METHODS = ['Transferencia', 'Débito automático', 'Tarjeta', 'Efectivo', 'Otro'];
const STATUS = {
  pagado: { label: 'Pagado', icon: '✓', cls: 'ok' },
  proximo: { label: 'Próximo a vencer', icon: '⏰', cls: 'warn' },
  vencido: { label: 'Vencido', icon: '⚠️', cls: 'bad' },
  confirmar: { label: 'Pendiente de confirmar', icon: '❔', cls: 'info' }
};
const catMeta = name => CATEGORIES.find(c => c.name === name) || CATEGORIES[CATEGORIES.length - 1];

const ICONS = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  gastos: '<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/>',
  facturas: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  hogar: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
  ajustes: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'
};
const NAV = [
  { id: 'home', label: 'Inicio' }, { id: 'gastos', label: 'Gastos' }, { id: 'facturas', label: 'Facturas' },
  { id: 'hogar', label: 'Mi hogar' }, { id: 'ajustes', label: 'Ajustes' }
];

/* ---------- 2. DATOS: ver store.js y services/ (Supabase) ---------- */

/* ---------- 3. LÓGICA DE DOMINIO ---------- */
const state = { view: 'home', from: 'home', hogarTab: 'productos', prodCat: 'Todas', prodQ: '', billQ: '', billService: '', billStatus: '', billMonth: '', gastosMonth: monthKey(todayISO()) };

const billState = b => b.status; // el estado lo deriva la base a partir de los pagos reales
const activeServices = () => Store.getServices().filter(s => !s.archived);
const pendingProducts = () => Store.getProducts().filter(p => p.pending);
function monthTotals(key) {
  const c = n => Math.round(n * 100) / 100, l = Store.getBills().filter(b => b.period === key);
  const total = c(l.reduce((a, b) => a + b.amount, 0)), paid = c(l.reduce((a, b) => a + b.paid, 0));
  return { total, paid, pending: c(total - paid), count: l.length };
}
function categoryTotals(key) {
  return CATEGORIES.map(c => {
    const items = Store.getBills().filter(b => b.period === key && b.category === c.name);
    return { ...c, items, total: items.reduce((a, b) => a + b.amount, 0) };
  }).filter(c => c.items.length);
}
function monthlySeries(key, n = 6) {
  return Array.from({ length: n }, (_, i) => {
    const k = addMonths(key, i - (n - 1)); const t = monthTotals(k);
    return { key: k, label: monthShort(k), total: t.total, paid: t.paid, pending: t.pending };
  });
}

/* ---------- 4. VISTAS ---------- */
const $main = $('#main');

function billRow(b, withActions = true) {
  const s = billState(b), m = STATUS[s], c = catMeta(b.category);
  const isBill = b.kind !== 'gasto';
  return `<article class="row" data-state="${s}">
    <div class="tile" aria-hidden="true">${c.emoji}</div>
    <div><div class="row-title">${esc(b.name)}${b.demo ? '<span class="demo">DEMO</span>' : ''}</div>
      <div class="row-sub">${esc(b.company || 'Gasto registrado')} · ${periodLabel(b.period)}</div></div>
    <strong class="amt">${money(b.amount)}</strong>
    <div class="row-meta" style="grid-column:2/-1"><span class="badge ${m.cls}">${m.icon} ${m.label}</span><span>${s === 'pagado' ? 'Pagado' : 'Vence'} ${fmtDate(s === 'pagado' && b.paidOn ? b.paidOn : b.due)}</span>${s !== 'pagado' && b.paid > 0 ? `<span>Pagado ${money(b.paid)} · Saldo ${money(b.balance)}</span>` : ''}</div>
    ${withActions ? `<div class="row-actions"><button class="btn sm ghost" data-action="bill-detail" data-id="${b.id}">${isBill ? 'Ver factura' : 'Ver detalle'}</button>${s !== 'pagado' ? `<button class="btn sm" data-action="bill-pay" data-id="${b.id}">Registrar pago</button>` : ''}</div>` : ''}
  </article>`;
}
function emptyBox(emoji, text) { return `<div class="empty"><div class="big" aria-hidden="true">${emoji}</div><p>${text}</p></div>`; }

function viewHome() {
  const st = Store.getSettings(), key = monthKey(todayISO());
  const t = monthTotals(key), p = monthTotals(addMonths(key, -1));
  const delta = p.total ? (t.total - p.total) / p.total * 100 : null;
  const deltaTxt = delta === null ? 'Sin datos del mes anterior' :
    `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta).toLocaleString('es-AR', { maximumFractionDigits: 1 })}% ${delta >= 0 ? 'más' : 'menos'} que ${periodLabel(addMonths(key, -1))}`;
  const dues = Store.getBills().filter(b => b.kind !== 'gasto' && b.status !== 'pagado').sort((a, b) => a.due.localeCompare(b.due)).slice(0, 5);
  return `<div class="fade">
    <div class="greet"><h1>¡Hola, Mateo y Salma! 👋</h1><p class="sub">Así viene ${esc(st.home)} este mes ${st.addressConfirmed && st.address ? ' · 📍 ' + esc(st.address) : ''}</p></div>
    <div class="home-grid">
      <section class="card hero span" aria-label="Resumen del mes">
        <p class="sub">Gastos registrados · ${periodLabel(key)}</p>
        <p class="big">${money(t.total)}</p>
        <div class="hero-split"><div><small>✓ Total pagado</small><strong>${money(t.paid)}</strong></div><div><small>⏰ Total pendiente</small><strong>${money(t.pending)}</strong></div></div>
        <span class="chip">${deltaTxt}</span>
      </section>
      <section class="card" aria-labelledby="hDues"><h2 id="hDues">Próximos vencimientos</h2>
        <div class="rows">${dues.length ? dues.map(b => billRow(b)).join('') : (Store.getBills().length ? emptyBox('🎉', 'No tenés vencimientos pendientes.') : emptyBox('🧾', 'Todavía no hay facturas. Agregá un servicio y subí tu primera factura.'))}</div>
      </section>
      <div class="stack">
        <section class="card" aria-labelledby="hQuick"><h2 id="hQuick">Accesos rápidos</h2>
          <div class="quick">
            <button data-action="open-invoice"><span class="em" aria-hidden="true">📄</span>Subir una factura</button>
            <button data-action="service-new"><span class="em" aria-hidden="true">🔌</span>Agregar un servicio</button>
            <button data-action="expense-new"><span class="em" aria-hidden="true">💸</span>Registrar un gasto</button>
            <button data-action="product-new"><span class="em" aria-hidden="true">🛍️</span>Agregar un producto</button>
          </div></section>
      </div>
    </div></div>`;
}

function monthYearSelects() {
  const [y, m] = state.gastosMonth.split('-').map(Number), cy = Number(todayISO().slice(0, 4));
  const months = Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${i + 1 === m ? 'selected' : ''}>${cap(new Date(Date.UTC(2020, i, 15)).toLocaleDateString('es-AR', { month: 'long', timeZone: 'UTC' }))}</option>`).join('');
  const years = []; for (let i = cy - 2; i <= cy + 1; i++) years.push(`<option ${i === y ? 'selected' : ''}>${i}</option>`);
  return `<label class="field" style="margin:0"><span class="sr-only">Mes</span><select id="gMonth" aria-label="Mes">${months}</select></label>
          <label class="field" style="margin:0"><span class="sr-only">Año</span><select id="gYear" aria-label="Año">${years.join('')}</select></label>`;
}
/* Los gráficos reciben datos planos: luego pueden alimentarse desde Supabase sin tocar el HTML. */
function renderCategoryBars(data) {
  const max = Math.max(...data.map(d => d.total), 1);
  return `<div class="bars" role="list">${data.map(d => `<div class="bar-row" role="listitem"><span aria-hidden="true">${d.emoji}</span>
    <div><div style="display:flex;justify-content:space-between;font-weight:600;margin-bottom:4px"><span>${esc(d.name)}</span><span>${money(d.total)}</span></div>
    <div class="bar-track"><div class="bar-fill" style="width:${Math.max(4, d.total / max * 100)}%"></div></div></div><span></span></div>`).join('')}</div>`;
}
function renderMonthlyColumns(data, activeKey) {
  const max = Math.max(...data.map(d => d.total), 1);
  return `<div class="cols" role="list">${data.map(d => `<div class="col ${d.key === activeKey ? 'active' : ''}" role="listitem" title="${periodLabel(d.key)}: ${money(d.total)}" aria-label="${periodLabel(d.key)}: ${money(d.total)}">
    <div class="col-bar" style="height:${d.total / max * 100}%"><div class="seg-pend" style="flex:${d.pending}"></div><div class="seg-paid" style="flex:${d.paid}"></div></div><small>${d.label}</small></div>`).join('')}</div>
    <div class="legend"><span><i class="seg-paid"></i>Pagado</span><span><i class="seg-pend"></i>Pendiente</span></div>`;
}
function viewGastos() {
  const key = state.gastosMonth, t = monthTotals(key), cats = categoryTotals(key);
  return `<div class="fade"><div class="view-head"><div><h1>Gastos</h1><p class="sub">${periodLabel(key)}</p></div><button class="btn" data-action="expense-new">+ Registrar gasto</button></div>
    <div class="filters" style="grid-template-columns:1fr 1fr">${monthYearSelects()}</div>
    <div class="sum3">
      <div class="card"><p class="lbl">Total del mes</p><p class="val">${money(t.total)}</p></div>
      <div class="card"><p class="lbl">✓ Total pagado</p><p class="val">${money(t.paid)}</p></div>
      <div class="card"><p class="lbl">⏰ Total pendiente</p><p class="val">${money(t.pending)}</p></div>
    </div>
    <div class="two" style="margin-top:16px">
      <section class="card"><h2>Por categoría</h2>${cats.length ? renderCategoryBars(cats) : emptyBox('📭', 'Sin registros en este período.')}</section>
      <section class="card"><h2>Últimos 6 meses</h2>${renderMonthlyColumns(monthlySeries(key), key)}</section>
    </div>
    <section style="margin-top:16px"><h2 style="font-size:1.05rem;margin-bottom:10px">Detalle por categoría</h2>
      ${cats.length ? cats.map(c => `<details class="cat"><summary><div class="tile" aria-hidden="true">${c.emoji}</div><div class="grow">${esc(c.name)}<small>${c.items.length} ${c.items.length === 1 ? 'registro' : 'registros'}</small></div><strong>${money(c.total)}</strong></summary><div class="rows">${c.items.map(b => billRow(b, false).replace('<article class="row"', `<article class="row" tabindex="0" role="button" data-action="bill-detail" data-id="${b.id}" style="cursor:pointer"`)).join('')}</div></details>`).join('') : emptyBox('📭', 'Todavía no hay gastos en este período.')}
    </section></div>`;
}

function filteredBills() {
  const q = norm(state.billQ);
  return Store.getBills().filter(b => b.kind !== 'gasto')
    .filter(b => !q || norm(b.name + ' ' + b.company).includes(q))
    .filter(b => !state.billService || b.serviceId === state.billService)
    .filter(b => !state.billStatus || billState(b) === state.billStatus)
    .filter(b => !state.billMonth || b.period === state.billMonth)
    .sort((a, b) => b.due.localeCompare(a.due));
}
function renderBillList() {
  const l = filteredBills(); const box = $('#billList'); if (!box) return;
  box.innerHTML = l.length ? l.map(b => billRow(b)).join('') : emptyBox('🧾', Store.getBills().some(b => b.kind !== 'gasto') ? 'No encontramos facturas con esos filtros.' : 'Todavía no cargaste facturas. Tocá «+ Subir factura» para empezar.');
  $('#billCount').textContent = `${l.length} ${l.length === 1 ? 'factura' : 'facturas'}`;
}
function viewFacturas() {
  const services = Store.getServices();
  const months = [...new Set(Store.getBills().map(b => b.period))].sort().reverse();
  return `<div class="fade"><div class="view-head"><div><h1>Facturas</h1><p class="sub" id="billCount"></p></div><button class="btn" data-action="open-invoice">+ Subir factura</button></div>
    <div class="filters">
      <label class="field full" style="margin:0"><span class="sr-only">Buscar</span><input type="search" id="billSearch" placeholder="🔍 Buscar factura o empresa" value="${esc(state.billQ)}"></label>
      <label class="field" style="margin:0"><span class="sr-only">Servicio</span><select id="billService" aria-label="Filtrar por servicio"><option value="">Todos los servicios</option>${services.map(s => `<option value="${s.id}" ${state.billService === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
      <label class="field" style="margin:0"><span class="sr-only">Estado</span><select id="billStatus" aria-label="Filtrar por estado"><option value="">Todos los estados</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${state.billStatus === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
      <label class="field" style="margin:0"><span class="sr-only">Mes</span><select id="billMonth" aria-label="Filtrar por mes"><option value="">Todos los meses</option>${months.map(m => `<option value="${m}" ${state.billMonth === m ? 'selected' : ''}>${periodLabel(m)}</option>`).join('')}</select></label>
    </div>
    <div class="rows" id="billList"></div>
    <p style="margin-top:18px"><button class="link" data-action="go" data-view="servicios">🔌 Administrar servicios →</button></p></div>`;
}

function viewServicios() {
  const all = Store.getServices(), act = all.filter(s => !s.archived), arch = all.filter(s => s.archived);
  const card = (s, archived) => `<article class="card svc"><div class="tile" aria-hidden="true">${catMeta(s.category).emoji}</div>
    <div><div class="row-title">${esc(s.name)}${s.demo ? '<span class="demo">DEMO</span>' : ''}</div><div class="row-sub">${esc(s.company)} · ${esc(s.category)}</div>${s.description ? `<div class="row-sub">${esc(s.description)}</div>` : ''}</div>
    <div class="row-actions" style="grid-column:1/-1">${archived ? `<button class="btn sm ghost" data-action="service-restore" data-id="${s.id}">Restaurar</button>` : `<button class="btn sm ghost" data-action="service-edit" data-id="${s.id}">Editar</button><button class="btn sm danger" data-action="service-archive" data-id="${s.id}">Archivar</button>`}</div></article>`;
  return `<div class="fade"><div class="view-head"><div><button class="link" data-action="go" data-view="${state.from === 'ajustes' ? 'ajustes' : 'facturas'}">← Volver</button><h1>Servicios</h1></div><button class="btn" data-action="service-new">+ Agregar servicio</button></div>
    <div class="rows">${act.length ? act.map(s => card(s, false)).join('') : emptyBox('🔌', 'Todavía no hay servicios activos. Tocá «+ Agregar servicio» para crear el primero.')}</div>
    ${arch.length ? `<h2 style="font-size:1.05rem;margin:22px 0 10px">Archivados</h2><div class="rows">${arch.map(s => card(s, true)).join('')}</div>` : ''}</div>`;
}

function viewHogar() {
  const n = pendingProducts().length;
  const body = state.hogarTab === 'productos' ? `
    <div class="view-head" style="margin-top:0"><p class="sub">Tocá un producto para sumarlo o quitarlo de la lista del súper.</p><button class="btn" data-action="product-new">+ Agregar producto</button></div>
    <label class="field"><span class="sr-only">Buscar producto</span><input type="search" id="prodSearch" placeholder="🔍 Buscar producto" value="${esc(state.prodQ)}"></label>
    <div class="chips" role="group" aria-label="Categorías">${['Todas', ...PRODUCT_CATEGORIES].map(c => `<button class="chip-btn" data-action="prod-cat" data-cat="${esc(c)}" aria-pressed="${state.prodCat === c}">${esc(c)}</button>`).join('')}</div>
    <div class="pgrid" id="prodGrid"></div>
    ${Store.getProducts().length ? '' : '<div class="card" style="margin-top:12px"><p class="sub" style="margin-bottom:10px">Todavía no hay productos. Agregá el primero o cargá un catálogo inicial de ejemplo (queda marcado como DEMO).</p><button class="btn ghost block" data-action="seed-products">Cargar catálogo inicial</button></div>'}` : `
    <div id="shopList"></div>`;
  return `<div class="fade"><div class="view-head"><h1>Mi hogar</h1></div>
    <div class="seg" role="tablist"><button role="tab" aria-selected="${state.hogarTab === 'productos'}" data-action="hogar-tab" data-tab="productos">🏠 Productos</button>
      <button role="tab" aria-selected="${state.hogarTab === 'lista'}" data-action="hogar-tab" data-tab="lista">🛒 Lista del súper <span class="count" data-badge>${n}</span></button></div>${body}</div>`;
}
function productCard(p) {
  return `<button class="pcard" data-action="toggle-product" data-id="${p.id}" aria-pressed="${!!p.pending}" aria-label="${esc(p.name)}: ${p.pending ? 'en la lista del súper' : 'tocar para agregar a la lista del súper'}">
    <span class="tag" aria-hidden="true">🛒 A comprar</span><span class="em" aria-hidden="true">${esc(p.emoji)}</span><span>${esc(p.name)}</span><small>${esc(p.category)}</small></button>`;
}
function renderProdGrid() {
  const g = $('#prodGrid'); if (!g) return; const q = norm(state.prodQ);
  const l = Store.getProducts().filter(p => (state.prodCat === 'Todas' || p.category === state.prodCat) && (!q || norm(p.name).includes(q)));
  g.innerHTML = l.length ? l.map(productCard).join('') : `<div style="grid-column:1/-1">${emptyBox('🔍', 'No hay productos que coincidan.')}</div>`;
}
function renderShopList() {
  const box = $('#shopList'); if (!box) return; const l = pendingProducts();
  box.innerHTML = `<section class="card"><h2>Lista del súper</h2><p class="sub" style="margin:-6px 0 14px"><b id="shopCount">${l.length}</b> ${l.length === 1 ? 'producto pendiente' : 'productos pendientes'}</p>
    <div class="rows">${l.length ? l.map(p => `<article class="row" style="grid-template-columns:auto 1fr auto"><div class="tile" aria-hidden="true">${esc(p.emoji)}</div><div><div class="row-title">${esc(p.name)}</div><div class="row-sub">${esc(p.category)}</div></div><button class="btn sm ghost" data-action="shop-remove" data-id="${p.id}" aria-label="Quitar ${esc(p.name)} de la lista">Quitar</button></article>`).join('') : emptyBox('🛒', 'Tu lista está vacía. Volvé a <b>Productos</b> y tocá lo que haga falta comprar.')}</div>
    ${l.length ? `<div class="list-actions"><button class="btn" data-action="list-copy">📋 Copiar lista</button>${navigator.share ? '<button class="btn ghost" data-action="list-share">📤 Compartir</button>' : ''}</div>` : ''}</section>`;
}

function viewAjustes() {
  const s = Store.getSettings(), theme = document.documentElement.dataset.theme;
  const sw = (id, label, desc, on) => `<div class="switch-row"><div><b>${label}</b><small>${desc}</small></div><button class="switch" role="switch" aria-checked="${on}" aria-label="${label}" data-action="setting-toggle" data-key="${id}"></button></div>`;
  return `<div class="fade"><div class="view-head"><h1>Ajustes</h1></div><div class="stack">
    <section class="card"><h2>🏠 Mi hogar</h2><form id="homeForm">
      <label class="field"><span>Nombre del hogar</span><input type="text" id="setHome" value="${esc(s.home)}" maxlength="60"></label>
      <label class="field"><span>Dirección</span><input type="text" id="setAddress" value="${esc(s.address)}" maxlength="120" placeholder="Ej.: Obispo Oro 321, Córdoba Capital"><small>${s.addressConfirmed ? '' : 'Sin confirmar: escribila y guardá para confirmarla.'}</small></label>
      <button class="btn block" type="submit">Guardar</button></form></section>
    <section class="card"><h2>🌗 Apariencia</h2>
      <div class="field"><span id="lblTheme" style="font-weight:700;font-size:.86rem">Tema</span><div class="radio-group" role="radiogroup" aria-labelledby="lblTheme">
        <button role="radio" aria-checked="${theme === 'light'}" data-action="set-theme" data-theme="light">☀️ Claro</button><button role="radio" aria-checked="${theme === 'dark'}" data-action="set-theme" data-theme="dark">🌙 Oscuro</button></div></div>
      <div class="field"><span id="lblAccent" style="font-weight:700;font-size:.86rem">Color de acento</span><div class="radio-group" role="radiogroup" aria-labelledby="lblAccent">
        ${[['indigo', 'Índigo', '#5456e8'], ['teal', 'Turquesa', '#0a7c72'], ['rose', 'Rosa', '#d01b47']].map(([k, n, c]) => `<button role="radio" aria-checked="${s.accent === k}" data-action="set-accent" data-accent="${k}"><span class="swatch" style="background:${c}"></span>${n}</button>`).join('')}</div></div>
      ${sw('reduceMotion', 'Reducir animaciones', 'Transiciones más sobrias', s.reduceMotion)}</section>
    <section class="card"><h2>🔔 Notificaciones</h2>
      ${sw('notifDue', 'Avisos de vencimientos', 'Preferencia guardada en este navegador', s.notifDue)}
      ${sw('notifList', 'Recordatorio de la lista del súper', 'Preferencia guardada en este navegador', s.notifList)}
      <div class="note warn" style="margin-top:12px"><span aria-hidden="true">ℹ️</span><span>En esta fase no se envían notificaciones reales. Estará disponible en la siguiente etapa.</span></div></section>
    <section class="card"><h2>🔌 Servicios</h2><p class="sub" style="margin-bottom:12px">Administrá los proveedores y categorías de tus facturas.</p><button class="btn ghost block" data-action="go" data-view="servicios">Administrar servicios</button></section>
    ${accountCard()}
  </div></div>`;
}

const VIEWS = { home: viewHome, gastos: viewGastos, facturas: viewFacturas, servicios: viewServicios, hogar: viewHogar, ajustes: viewAjustes };
function render(scroll = false) {
  $main.innerHTML = VIEWS[state.view]();
  if (state.view === 'facturas') renderBillList();
  if (state.view === 'hogar') { state.hogarTab === 'productos' ? renderProdGrid() : renderShopList(); }
  const navId = state.view === 'servicios' ? (state.from === 'ajustes' ? 'ajustes' : 'facturas') : state.view;
  $$('.nav-btn').forEach(b => b.dataset.nav === navId ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  updateBadges();
  if (scroll) window.scrollTo({ top: 0 });
}
function go(view) {
  if (view === 'servicios') state.from = state.view === 'ajustes' ? 'ajustes' : 'facturas';
  state.view = view; render(true);
}
function updateBadges() {
  const n = pendingProducts().length;
  $$('[data-nav="hogar"] .nav-badge').forEach(b => { b.textContent = n; b.hidden = !n; });
  $$('[data-badge]').forEach(b => b.textContent = n);
  const c = $('#shopCount'); if (c) c.textContent = n;
}
function buildNav() {
  const html = NAV.map(n => `<button class="nav-btn" data-action="go" data-view="${n.id}" data-nav="${n.id}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[n.id]}</svg><span>${n.label}</span>${n.id === 'hogar' ? '<span class="nav-badge" aria-label="productos pendientes" hidden>0</span>' : ''}</button>`).join('');
  $('#bottomNav').innerHTML = html; $('#sideNav').innerHTML = html;
}

/* ---------- Tema, preferencias y avisos ---------- */
function setTheme(t, announce = true) {
  const root = document.documentElement;
  root.classList.add('theming'); root.dataset.theme = t;
  try { localStorage.setItem('md:theme', t); } catch {}
  $('#themeSwitch').setAttribute('aria-checked', String(t === 'dark'));
  $('meta[name="theme-color"]').content = t === 'dark' ? '#0d0f18' : '#f3f4fa';
  $$('[data-action="set-theme"]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.theme === t)));
  setTimeout(() => root.classList.remove('theming'), 400);
  if (announce) toast(t === 'dark' ? '🌙 Modo oscuro activado' : '☀️ Modo claro activado');
}
function applyPrefs() {
  const s = Store.getSettings();
  document.documentElement.dataset.accent = s.accent;
  document.documentElement.classList.toggle('reduce-motion', !!s.reduceMotion);
  $$('[data-home-name]').forEach(e => e.textContent = s.home);
  document.title = s.home;
}
function toast(msg, type = '') {
  const el = document.createElement('div'); el.className = 'toast ' + type; el.textContent = msg; $('#toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, 2600);
}

/* ---------- 5. MODALES ---------- */
let lastFocus = null, modalCleanup = null;
function openModal(title, html, onMount) {
  lastFocus = document.activeElement;
  $('#modalTitle').textContent = title; $('#modalBody').innerHTML = html;
  const root = $('#modalRoot'); root.hidden = false; document.body.classList.add('lock');
  requestAnimationFrame(() => root.classList.add('open'));
  if (onMount) modalCleanup = onMount($('#modalBody')) || null;
  setTimeout(() => { const f = $('#modalBody input:not([type=file]),#modalBody select,#modalBody button'); (f || $('.modal header button')).focus({ preventScroll: true }); }, 60);
}
function closeModal() {
  const root = $('#modalRoot'); if (root.hidden) return;
  root.classList.remove('open'); document.body.classList.remove('lock');
  if (modalCleanup) { modalCleanup(); modalCleanup = null; }
  setTimeout(() => { root.hidden = true; $('#modalBody').innerHTML = ''; }, 250);
  if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
}
const formActions = (label, extra = '') => `<div class="form-actions"><button type="button" class="btn ghost" data-action="modal-close">Cancelar</button><button type="submit" class="btn">${label}</button></div>${extra}`;
const catOptions = sel => CATEGORIES.map(c => `<option ${c.name === sel ? 'selected' : ''}>${c.emoji} ${c.name}</option>`).join('');
const catFromOption = v => v.replace(/^\S+\s/, '');

function openInvoiceModal() {
  const services = activeServices();
  openModal('Subir factura', `<form id="invForm" novalidate>
    <div class="note" style="margin-bottom:14px"><span aria-hidden="true">🔒</span><span>El archivo se guarda en un espacio privado, visible solo para los miembros del hogar. Cargá los datos a mano: la lectura automática todavía no está activada.</span></div>
    <label class="field"><span>Archivo (PDF, JPG, PNG o WEBP · máx. 10 MB)</span><input type="file" id="invFile" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"></label>
    <div class="preview" id="invPreview" hidden></div>
    <label class="field"><span>Servicio</span><select id="invService">${services.map(s => `<option value="${s.id}">${esc(s.name)} · ${esc(s.company)}</option>`).join('')}</select></label>
    <button type="button" class="link" id="invNewToggle" aria-expanded="false">+ Crear servicio nuevo</button>
    <div id="invNew" hidden style="margin:6px 0 10px;padding:14px;border-radius:14px;background:var(--tile)">
      <label class="field"><span>Nombre del servicio</span><input type="text" id="nsName" maxlength="50"></label>
      <label class="field"><span>Empresa proveedora</span><input type="text" id="nsCompany" maxlength="60"></label>
      <label class="field" style="margin:0"><span>Categoría</span><select id="nsCat">${catOptions('Otros')}</select></label></div>
    <div class="grid2"><label class="field"><span>Período</span><select id="invPeriod">${Array.from({ length: 12 }, (_, i) => { const k = addMonths(monthKey(todayISO()), 1 - i); return `<option value="${k}" ${i === 1 ? 'selected' : ''}>${periodLabel(k)}</option>`; }).join('')}</select></label>
      <label class="field"><span>Vencimiento</span><input type="date" id="invDue" value="${addDays(todayISO(), 10)}"></label></div>
    <label class="field"><span>Importe (ARS)</span><input type="number" id="invAmount" inputmode="decimal" min="0" step="1" placeholder="0"></label>
    <div class="grid2"><label class="field"><span>Consumo (opcional)</span><input type="number" id="invCons" inputmode="decimal" min="0" step="any"></label><label class="field"><span>Unidad</span><select id="invUnit"><option>kWh</option><option>m³</option><option>otra</option></select></label></div>
    ${formActions('Guardar factura')}</form>`, body => {
    let url = null;
    const file = $('#invFile', body), prev = $('#invPreview', body);
    file.addEventListener('change', () => {
      if (url) { URL.revokeObjectURL(url); url = null; }
      const f = file.files[0]; if (!f) { prev.hidden = true; return; }
      prev.hidden = false; const kb = (f.size / 1024).toFixed(0);
      if (f.type.startsWith('image/')) { url = URL.createObjectURL(f); prev.innerHTML = `<img src="${url}" alt="Vista previa de la factura"><div><b>${esc(f.name)}</b><br>${kb} KB</div>`; }
      else prev.innerHTML = `<span style="font-size:2.2rem" aria-hidden="true">📄</span><div><b>${esc(f.name)}</b><br>${kb} KB · sin vista previa</div>`;
    });
    $('#invNewToggle', body).addEventListener('click', e => {
      const box = $('#invNew', body); box.hidden = !box.hidden; e.currentTarget.setAttribute('aria-expanded', String(!box.hidden));
      e.currentTarget.textContent = box.hidden ? '+ Crear servicio nuevo' : '− Usar un servicio existente'; if (!box.hidden) $('#nsName', body).focus();
    });
    $('#invForm', body).addEventListener('submit', e => {
      e.preventDefault();
      const f = file.files[0]; if (!f) return toast('Elegí un archivo para continuar', 'bad');
      if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(f.type)) return toast('Formato no admitido: usá PDF, JPG, PNG o WEBP', 'bad');
      if (f.size > 10 * 1024 * 1024) return toast('El archivo supera los 10 MB', 'bad');
      const amount = Number($('#invAmount', body).value), due = $('#invDue', body).value;
      if (!(amount > 0)) return toast('Ingresá un importe mayor a cero', 'bad');
      if (!due) return toast('Indicá la fecha de vencimiento', 'bad');
      const newSvc = !$('#invNew', body).hidden ? { name: $('#nsName', body).value.trim(), company: $('#nsCompany', body).value.trim(), category: catFromOption($('#nsCat', body).value) } : null;
      if (newSvc && (!newSvc.name || !newSvc.company)) return toast('Completá nombre y empresa del servicio nuevo', 'bad');
      const serviceId = newSvc ? null : $('#invService', body).value;
      if (!newSvc && !serviceId) return toast('Primero creá un servicio', 'bad');
      const cu = Number($('#invCons', body).value), period = $('#invPeriod', body).value;
      busy(e.currentTarget, async () => { await Store.addInvoice({ file: f, serviceId, newService: newSvc, amount, due, period, consumption: cu > 0 ? { units: cu, unit: $('#invUnit', body).value } : null }); closeModal(); render(); toast('📄 Factura guardada. Revisá los datos y confirmala'); });
    });
    return () => { if (url) URL.revokeObjectURL(url); };
  });
}
function openBillDetail(id) {
  const b = Store.getBills().find(x => x.id === id); if (!b) return;
  const s = billState(b), m = STATUS[s], c = catMeta(b.category);
  openModal(b.kind === 'gasto' ? 'Detalle del gasto' : 'Detalle de la factura', `<div class="detail">
    <div style="display:flex;gap:14px;align-items:center"><div class="tile" style="width:58px;height:58px;font-size:2rem" aria-hidden="true">${c.emoji}</div><div><h3>${esc(b.name)}${b.demo ? '<span class="demo">DEMO</span>' : ''}</h3><span class="badge ${m.cls}">${m.icon} ${m.label}</span></div></div>
    <dl><dt>Empresa</dt><dd>${esc(b.company || '—')}</dd><dt>Categoría</dt><dd>${esc(b.category)}</dd><dt>Período</dt><dd>${periodLabel(b.period)}</dd>
    <dt>Importe total</dt><dd>${money(b.amount)}</dd><dt>Total pagado</dt><dd>${money(b.paid)}</dd><dt>Saldo pendiente</dt><dd>${money(b.balance)}</dd>${b.consumption ? `<dt>Consumo</dt><dd>${b.consumption.units.toLocaleString('es-AR')} ${esc(b.consumption.unit)}</dd>` : ''}<dt>${b.kind === 'gasto' ? 'Fecha' : 'Vencimiento'}</dt><dd>${fmtDateLong(b.due)}</dd>
    ${b.paidOn ? `<dt>Pagado el</dt><dd>${fmtDateLong(b.paidOn)}</dd><dt>Medio de pago</dt><dd>${esc(b.method || '—')}</dd>` : ''}
    </dl>
    <div id="detFiles" class="note"><span aria-hidden="true">📎</span><span>Buscando comprobantes…</span></div>
    <div class="form-actions" style="margin-top:12px">${s === 'confirmar' ? `<button class="btn ghost" data-action="bill-confirm" data-id="${b.id}">Confirmar datos</button>` : ''}${s !== 'pagado' ? `<button class="btn" data-action="bill-pay" data-id="${b.id}">Registrar pago</button>` : `<button class="btn ghost" data-action="modal-close">Cerrar</button>`}${b.paid === 0 ? `<button class="btn danger" data-action="bill-delete" data-id="${b.id}">Eliminar</button>` : ''}</div></div>`, body => loadBillFiles(b, body));
}
function openPaymentModal(id) {
  const b = Store.getBills().find(x => x.id === id); if (!b) return;
  openModal('Registrar pago', `<form id="payForm" novalidate><p class="sub" style="margin-bottom:14px">${esc(b.name)} · ${periodLabel(b.period)}</p>
    <label class="field"><span>Importe pagado (ARS)</span><input type="number" id="payAmount" inputmode="decimal" min="0" step="1" value="${b.balance}"></label>
    <div class="grid2"><label class="field"><span>Fecha de pago</span><input type="date" id="payDate" value="${todayISO()}"></label>
    <label class="field"><span>Medio</span><select id="payMethod">${PAY_METHODS.map(m => `<option>${m}</option>`).join('')}</select></label></div>
    <div class="note" style="margin-bottom:6px"><span aria-hidden="true">💡</span><span>Total ${money(b.amount)} · Pagado ${money(b.paid)} · Saldo ${money(b.balance)}. Podés registrar un pago parcial. Esto solo deja constancia: no realiza ningún pago.</span></div>${formActions('Confirmar pago')}</form>`, body => {
    $('#payForm', body).addEventListener('submit', e => {
      e.preventDefault(); const amount = Number($('#payAmount', body).value), paidOn = $('#payDate', body).value;
      if (!(amount > 0) || !paidOn) return toast('Revisá el importe y la fecha', 'bad');
      if (amount > b.balance + 0.001) return toast('El pago supera el saldo pendiente (' + money(b.balance) + ')', 'bad');
      busy(e.currentTarget, async () => { await Store.registerPayment(id, { amount, paidOn, method: $('#payMethod', body).value }); closeModal(); render(); toast('✓ Pago registrado'); });
    });
  });
}
function openExpenseModal() {
  openModal('Registrar gasto', `<form id="expForm" novalidate>
    <label class="field"><span>Descripción</span><input type="text" id="exName" maxlength="60" placeholder="Ej.: Reparación de canilla"></label>
    <label class="field"><span>Categoría</span><select id="exCat">${catOptions('Otros')}</select></label>
    <div class="grid2"><label class="field"><span>Importe (ARS)</span><input type="number" id="exAmount" inputmode="decimal" min="0" step="1"></label>
    <label class="field"><span>Fecha</span><input type="date" id="exDate" value="${todayISO()}"></label></div>${formActions('Guardar gasto')}</form>`, body => {
    $('#expForm', body).addEventListener('submit', e => {
      e.preventDefault(); const name = $('#exName', body).value.trim(), amount = Number($('#exAmount', body).value), date = $('#exDate', body).value;
      if (!name) return toast('Escribí una descripción', 'bad'); if (!(amount > 0)) return toast('Ingresá un importe mayor a cero', 'bad'); if (!date) return toast('Indicá la fecha', 'bad');
      busy(e.currentTarget, async () => { await Store.addExpense({ name, category: catFromOption($('#exCat', body).value), amount, date }); closeModal(); render(); toast('💸 Gasto registrado'); });
    });
  });
}
function openProductModal() {
  openModal('Agregar producto', `<form id="prodForm" novalidate>
    <label class="field"><span>Nombre del producto</span><input type="text" id="prName" maxlength="40" placeholder="Ej.: Cepillo de dientes"></label>
    <label class="field"><span>Categoría</span><select id="prCat">${PRODUCT_CATEGORIES.map(c => `<option>${c}</option>`).join('')}</select></label>
    <div class="field"><span id="lblEm">Icono o emoji</span><input type="text" id="prEmoji" maxlength="8" value="🛒" aria-labelledby="lblEm" style="font-size:1.6rem;text-align:center">
      <div class="emoji-pick" role="group" aria-label="Emojis sugeridos">${EMOJI_CHOICES.map(e => `<button type="button" data-emoji="${e}" aria-pressed="${e === '🛒'}" aria-label="Usar ${e}">${e}</button>`).join('')}</div></div>${formActions('Guardar producto')}</form>`, body => {
    const input = $('#prEmoji', body), pick = $$('[data-emoji]', body);
    const sync = () => pick.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.emoji === input.value.trim())));
    pick.forEach(b => b.addEventListener('click', () => { input.value = b.dataset.emoji; sync(); }));
    input.addEventListener('input', sync);
    $('#prodForm', body).addEventListener('submit', e => {
      e.preventDefault(); const name = $('#prName', body).value.trim().replace(/\s+/g, ' ');
      if (!name) return toast('Escribí el nombre del producto', 'bad');
      if (Store.getProducts().some(p => norm(p.name) === norm(name))) return toast(`«${name}» ya existe en Mi hogar`, 'bad');
      const emoji = input.value.trim() || '🛒', cat = $('#prCat', body).value;
      busy(e.currentTarget, async () => { await Store.addProduct({ name, emoji, category: cat }); closeModal(); if (state.view !== 'hogar' || state.hogarTab !== 'productos') { state.view = 'hogar'; state.hogarTab = 'productos'; state.prodCat = 'Todas'; state.prodQ = ''; } render(); toast(`${emoji} «${name}» agregado a Mi hogar`); });
    });
  });
}
function openServiceModal(id) {
  const s = id ? Store.getServices().find(x => x.id === id) : null;
  openModal(s ? 'Editar servicio' : 'Agregar servicio', `<form id="svcForm" novalidate>
    <label class="field"><span>Nombre del servicio</span><input type="text" id="svName" maxlength="50" value="${esc(s?.name || '')}"></label>
    <label class="field"><span>Empresa proveedora</span><input type="text" id="svCompany" maxlength="60" value="${esc(s?.company || '')}"></label>
    <label class="field"><span>Categoría</span><select id="svCat">${catOptions(s?.category || 'Otros')}</select></label>
    <label class="field"><span>Descripción (opcional)</span><textarea id="svDesc" maxlength="200">${esc(s?.description || '')}</textarea></label>${formActions(s ? 'Guardar cambios' : 'Guardar servicio')}</form>`, body => {
    $('#svcForm', body).addEventListener('submit', e => {
      e.preventDefault(); const name = $('#svName', body).value.trim(), company = $('#svCompany', body).value.trim();
      if (!name || !company) return toast('Completá el nombre y la empresa', 'bad');
      const data = { name, company, category: catFromOption($('#svCat', body).value), description: $('#svDesc', body).value.trim() };
      busy(e.currentTarget, async () => { await (s ? Store.updateService(id, data) : Store.addService(data)); closeModal(); render(); toast(s ? '✓ Servicio actualizado' : '🔌 Servicio agregado'); });
    });
  });
}
function openConfirm(title, text, label, onOk) {
  openModal(title, `<p style="margin-bottom:16px">${text}</p><div class="form-actions"><button class="btn ghost" data-action="modal-close">Cancelar</button><button class="btn danger" id="cfOk">${label}</button></div>`, body => {
    $('#cfOk', body).addEventListener('click', () => { closeModal(); onOk(); });
  });
}

/* ---------- Acciones ---------- */
function listText() {
  const l = pendingProducts();
  return `🛒 Lista del súper · ${Store.getSettings().home}\n` + l.map(p => `• ${p.emoji} ${p.name} (${p.category})`).join('\n');
}
async function copyText(t) {
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(t); return true; } } catch {}
  const ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0';
  document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch {} ta.remove(); return ok;
}
async function toggleProduct(id, el) {
  const p = Store.getProducts().find(x => x.id === id); if (!p) return;
  const now = !p.pending;
  if (el) el.setAttribute('aria-pressed', String(now));
  try {
    await Store.setProductPending(id, now);
    if (el) el.setAttribute('aria-label', `${p.name}: ${now ? 'en la lista del súper' : 'tocar para agregar a la lista del súper'}`);
    updateBadges(); toast(now ? `🛒 ${p.name} agregado a la lista del súper` : `✓ ${p.name} quitado de la lista`);
  } catch (err) { if (el) el.setAttribute('aria-pressed', String(!now)); updateBadges(); toast(friendlyError(err), 'bad'); }
}

const ACTIONS = {
  go: el => go(el.dataset.view),
  'toggle-theme': () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'),
  'set-theme': el => setTheme(el.dataset.theme),
  'set-accent': el => { const s = Store.getSettings(); s.accent = el.dataset.accent; Store.saveSettings(s); applyPrefs(); render(); toast('🎨 Color de acento actualizado'); },
  'setting-toggle': el => { const s = Store.getSettings(), k = el.dataset.key; s[k] = !s[k]; Store.saveSettings(s); applyPrefs(); el.setAttribute('aria-checked', String(s[k])); toast('Preferencia guardada en este navegador'); },
  'modal-close': closeModal,
  'open-invoice': openInvoiceModal, 'expense-new': openExpenseModal, 'product-new': openProductModal,
  'service-new': () => openServiceModal(), 'service-edit': el => openServiceModal(el.dataset.id),
  'service-archive': el => act(async () => { const s = await Store.setServiceArchived(el.dataset.id, true); render(); toast(`📦 «${s.name}» archivado`); }),
  'service-restore': el => act(async () => { const s = await Store.setServiceArchived(el.dataset.id, false); render(); toast(`✓ «${s.name}» restaurado`); }),
  'bill-detail': el => openBillDetail(el.dataset.id),
  'bill-pay': el => { closeModal(); setTimeout(() => openPaymentModal(el.dataset.id), 280); },
  'bill-confirm': el => act(async () => { await Store.confirmBill(el.dataset.id); closeModal(); render(); toast('✓ Datos confirmados'); }),
  'bill-delete': el => { const id = el.dataset.id; closeModal(); setTimeout(() => openConfirm('Eliminar registro', 'Se eliminará el registro y su comprobante. Esta acción no se puede deshacer.', 'Eliminar', () => act(async () => { await Store.deleteBill(id); render(); toast('🗑️ Registro eliminado'); })), 280); },
  'toggle-product': el => toggleProduct(el.dataset.id, el),
  'prod-cat': el => { state.prodCat = el.dataset.cat; $$('[data-action="prod-cat"]').forEach(b => b.setAttribute('aria-pressed', String(b === el))); renderProdGrid(); },
  'hogar-tab': el => { state.hogarTab = el.dataset.tab; render(); },
  'shop-remove': el => act(async () => { const p = await Store.setProductPending(el.dataset.id, false); renderShopList(); updateBadges(); toast(`✓ ${p.name} quitado de la lista`); }),
  'list-copy': async () => toast(await copyText(listText()) ? '📋 Lista copiada' : 'No se pudo copiar en este navegador', ''),
  'list-share': async () => { try { await navigator.share({ title: 'Lista del súper', text: listText() }); } catch (e) { if (e.name !== 'AbortError') toast('No se pudo compartir', 'bad'); } },
  'seed-products': el => act(async () => { await Store.seedProducts(); render(); toast('🛍️ Catálogo inicial cargado'); }),
  'sign-out': () => act(() => Auth.signOut()),
  'invite-new': () => openInviteModal()
};

/* ---------- 6. EVENTOS ---------- */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]'); if (!el) return;
  const fn = ACTIONS[el.dataset.action]; if (fn) fn(el);
});
document.addEventListener('keydown', e => {
  if (!$('#modalRoot').hidden) {
    if (e.key === 'Escape') return closeModal();
    if (e.key === 'Tab') {
      const f = $$('.modal button,.modal input,.modal select,.modal textarea').filter(x => !x.disabled && x.offsetParent !== null);
      if (!f.length) return; const a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    }
  }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('article[data-action]')) { e.preventDefault(); e.target.click(); }
});
document.addEventListener('input', e => {
  if (e.target.id === 'prodSearch') { state.prodQ = e.target.value; renderProdGrid(); }
  if (e.target.id === 'billSearch') { state.billQ = e.target.value; renderBillList(); }
});
document.addEventListener('change', e => {
  const id = e.target.id;
  if (id === 'billService') { state.billService = e.target.value; renderBillList(); }
  if (id === 'billStatus') { state.billStatus = e.target.value; renderBillList(); }
  if (id === 'billMonth') { state.billMonth = e.target.value; renderBillList(); }
  if (id === 'gMonth' || id === 'gYear') { state.gastosMonth = `${$('#gYear').value}-${String($('#gMonth').value).padStart(2, '0')}`; render(); }
});
document.addEventListener('submit', e => {
  if (e.target.id === 'homeForm') {
    e.preventDefault();
    const name = $('#setHome').value.trim() || DEFAULT_SETTINGS.home, address = $('#setAddress').value.trim();
    busy(e.target, async () => { await Store.saveHousehold({ name, address }); applyPrefs(); render(); toast('🏠 Datos del hogar guardados'); });
  }
});

/* Arranque: lo invoca main.js cuando hay sesión y hogar cargado */
export function startApp() {
  buildNav();
  applyPrefs();
  setTheme(document.documentElement.dataset.theme, false);
  render();
}

/* ---------- Helpers de operaciones asíncronas ---------- */
async function act(fn) { try { await fn(); } catch (err) { console.error(err); toast(friendlyError(err), 'bad'); } }
async function busy(form, fn) {
  const btns = $$('button', form); btns.forEach(b => b.disabled = true);
  try { await fn(); } catch (err) { console.error(err); toast(friendlyError(err), 'bad'); } finally { btns.forEach(b => b.disabled = false); }
}
async function loadBillFiles(b, body) {
  const box = $('#detFiles', body); if (!box) return;
  try {
    const files = await Store.getAttachmentLinks(b.id);
    box.innerHTML = '<span aria-hidden="true">📎</span><span>' + (files.length ? files.map(f => `<a class="link" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.name)}</a>`).join('<br>') : 'Sin comprobante adjunto.') + '</span>';
  } catch (err) { box.innerHTML = '<span aria-hidden="true">⚠️</span><span>No se pudo cargar el comprobante: ' + esc(friendlyError(err)) + '</span>'; }
}
function accountCard() {
  const u = Store.getUser(), h = Store.getHousehold();
  return `<section class="card"><h2>👥 Cuenta y miembros</h2>
    <div class="switch-row"><span>Sesión</span><b style="word-break:break-all">${esc(u.email)}</b></div>
    ${Store.getMembers().map(m => `<div class="switch-row"><span>${esc(m.name || 'Miembro')}</span><b>${m.role === 'owner' ? 'Administrador' : 'Miembro'}</b></div>`).join('')}
    ${h.role === 'owner' ? '<button class="btn ghost block" style="margin-top:12px" data-action="invite-new">Invitar a otra persona</button>' : ''}
    <button class="btn danger block" style="margin-top:12px" data-action="sign-out">Cerrar sesión</button></section>
    <section class="card"><h2>ℹ️ Información</h2>
      <div class="switch-row"><span>Zona horaria</span><b>America/Argentina/Cordoba</b></div>
      <div class="switch-row"><span>Moneda</span><b>Peso argentino (ARS)</b></div>
      <div class="note" style="margin-top:12px"><span aria-hidden="true">🔔</span><span>Los recordatorios de vencimientos todavía no están activos.</span></div></section>`;
}
function openInviteModal() {
  openModal('Invitar al hogar', `<form id="invitForm" novalidate><p class="sub" style="margin-bottom:12px">Se genera un código de un solo uso que vence en 7 días. Si indicás un correo, solo esa cuenta podrá usarlo.</p>
    <label class="field"><span>Correo de la persona (opcional)</span><input type="text" id="invMail" inputmode="email" autocapitalize="off"></label>${formActions('Generar código')}</form>`, body => {
    $('#invitForm', body).addEventListener('submit', e => {
      e.preventDefault(); const mail = $('#invMail', body).value.trim();
      busy(e.currentTarget, async () => {
        const code = await Store.createInvite(mail);
        $('#modalBody').innerHTML = `<p class="sub">Compartí este código por un canal privado. Se muestra una sola vez:</p><p style="font-size:1.8rem;font-weight:800;letter-spacing:.12em;text-align:center;margin:16px 0;user-select:all">${esc(code)}</p><button class="btn block" data-action="modal-close">Listo</button>`;
      });
    });
  });
}

export { render, applyPrefs };
