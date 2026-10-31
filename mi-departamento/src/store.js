/* Capa de negocio: mantiene una caché en memoria hidratada desde Supabase.
   La interfaz lee de forma síncrona (getX) y escribe con métodos async que
   llaman a los servicios y luego recargan los datos desde el servidor. */
import * as Auth from './services/auth.js';
import * as Homes from './services/households.js';
import * as Catalog from './services/catalog.js';
import * as Bills from './services/bills.js';
import * as Products from './services/products.js';

export const DEFAULT_SETTINGS = { home: 'Mi Departamento', address: '', addressConfirmed: false, accent: 'indigo', reduceMotion: false, notifDue: true, notifList: false };
const PREFS_KEY = 'md:prefs'; // preferencias personales (solo este dispositivo)
const cache = { user: null, household: null, members: [], services: [], bills: [], products: [] };
const localPrefs = () => { try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); } catch { return {}; } };

const mapService = r => ({ id: r.id, name: r.name, company: r.company || '', category: r.category, description: r.description || '', archived: !!r.archived_at, demo: r.is_demo });
const mapBill = r => ({
  id: r.id, serviceId: r.service_id, name: r.name, company: r.company || '', category: r.category, kind: r.kind,
  amount: Number(r.amount), paid: Number(r.paid_amount), balance: Number(r.balance), period: r.period.slice(0, 7), due: r.due_date,
  paidOn: r.last_paid_on, method: r.last_method, status: r.status, confirmed: r.confirmed, demo: r.is_demo,
  consumption: r.consumption_units != null ? { units: Number(r.consumption_units), unit: r.consumption_unit } : null
});
const mapProduct = r => ({ id: r.id, name: r.name, emoji: r.emoji, category: r.category, pending: r.needs_purchase, demo: r.is_demo });

export const Store = {
  /** Carga el hogar del usuario y sus datos. Devuelve false si todavía no pertenece a ningún hogar. */
  async load() {
    cache.user = await Auth.getUser();
    const h = await Homes.getMine(cache.user.id);
    if (!h) { cache.household = null; return false; }
    cache.household = { id: h.id, name: h.name, address: h.address, addressConfirmed: h.address_confirmed, role: h.role, displayName: h.displayName };
    const [members, services, bills, products] = await Promise.all([Homes.listMembers(h.id), Catalog.list(), Bills.list(), Products.list()]);
    cache.members = members.map(m => ({ userId: m.user_id, role: m.role, name: m.display_name }));
    cache.services = services.map(mapService); cache.bills = bills.map(mapBill); cache.products = products.map(mapProduct);
    return true;
  },
  async reloadBills() { cache.bills = (await Bills.list()).map(mapBill); },
  async reloadServices() { cache.services = (await Catalog.list()).map(mapService); },
  async reloadProducts() { cache.products = (await Products.list()).map(mapProduct); },

  getUser: () => cache.user, getHousehold: () => cache.household, getMembers: () => cache.members,
  getServices: () => cache.services, getBills: () => cache.bills, getProducts: () => cache.products,

  /* Preferencias: nombre/dirección del hogar son compartidas (BD); tema, acento y avisos son personales (local). */
  getSettings() {
    const h = cache.household || {};
    return { ...DEFAULT_SETTINGS, ...localPrefs(), home: h.name || DEFAULT_SETTINGS.home, address: h.address || '', addressConfirmed: !!h.addressConfirmed };
  },
  saveSettings(s) {
    const { accent, reduceMotion, notifDue, notifList } = s;
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ accent, reduceMotion, notifDue, notifList })); } catch {}
  },
  async saveHousehold({ name, address }) {
    const r = await Homes.update(cache.household.id, { name, address: address || null, address_confirmed: !!address });
    Object.assign(cache.household, { name: r.name, address: r.address, addressConfirmed: r.address_confirmed });
  },
  async createInvite(email) { return Homes.createInvite(cache.household.id, email); },

  /* Servicios */
  async addService(d) { await Catalog.create(cache.household.id, d); await this.reloadServices(); },
  async updateService(id, d) { await Catalog.update(id, d); await this.reloadServices(); },
  async setServiceArchived(id, archived) { await Catalog.setArchived(id, archived); await this.reloadServices(); return cache.services.find(s => s.id === id); },

  /* Facturas: sube el archivo, crea el registro y lo asocia; si algo falla deshace todo lo anterior. */
  async addInvoice({ file, serviceId, newService, amount, due, period, consumption }) {
    const hid = cache.household.id;
    let svc;
    if (newService) { svc = mapService(await Catalog.create(hid, newService)); cache.services.push(svc); }
    else svc = cache.services.find(s => s.id === serviceId);
    const billId = crypto.randomUUID();
    let path = null, billCreated = false;
    try {
      path = await Bills.uploadFile(hid, billId, file);
      await Bills.create({
        id: billId, household_id: hid, service_id: svc.id, name: svc.name, company: svc.company || null, category: svc.category,
        kind: 'factura', amount, due_date: due, period: period + '-01', confirmed: false,
        consumption_units: consumption ? consumption.units : null, consumption_unit: consumption ? consumption.unit : null
      });
      billCreated = true;
      await Bills.addAttachment({ household_id: hid, bill_id: billId, storage_path: path, original_name: file.name, mime_type: file.type, size_bytes: file.size });
    } catch (err) {
      if (billCreated) await Bills.remove(billId).catch(() => {});
      if (path) await Bills.removeFile(path).catch(() => {});
      throw err;
    }
    await this.reloadBills();
  },
  async addExpense({ name, category, amount, date }) {
    await Bills.createExpense({ householdId: cache.household.id, name, category, amount, date });
    await this.reloadBills();
  },
  async registerPayment(billId, { amount, paidOn, method }) { await Bills.registerPayment({ billId, amount, paidOn, method }); await this.reloadBills(); },
  async confirmBill(id) { await Bills.update(id, { confirmed: true }); await this.reloadBills(); },
  async deleteBill(id) {
    const files = await Bills.listAttachments(id);
    await Bills.remove(id);
    await Promise.all(files.map(f => Bills.removeFile(f.storage_path).catch(() => {})));
    await this.reloadBills();
  },
  async getAttachmentLinks(billId) {
    const files = await Bills.listAttachments(billId);
    return Promise.all(files.map(async f => ({ name: f.original_name, url: await Bills.signedUrl(f.storage_path) })));
  },

  /* Productos (optimista con reversión si falla) */
  async addProduct(p) { await Products.create(cache.household.id, p); await this.reloadProducts(); },
  async setProductPending(id, pending) {
    const p = cache.products.find(x => x.id === id); if (!p) return null;
    const prev = p.pending; p.pending = pending;
    try { await Products.setNeedsPurchase(id, pending); } catch (err) { p.pending = prev; throw err; }
    return p;
  },
  async seedProducts() { const n = await Products.seedStarter(cache.household.id); await this.reloadProducts(); return n; }
};
