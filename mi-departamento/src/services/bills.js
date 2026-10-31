import { supabase } from '../lib/supabase.js';
const must = ({ data, error }) => { if (error) throw error; return data; };
const BUCKET = 'bill-files';

/** Lectura: la vista calcula pagado, saldo y estado a partir de los pagos reales. */
export const list = async () => must(await supabase.from('bills_overview').select('*').order('due_date', { ascending: false }).limit(5000));
export const create = async row => must(await supabase.from('bills').insert(row).select().single());
export const update = async (id, patch) => must(await supabase.from('bills').update(patch).eq('id', id).select().single());
export const remove = async id => must(await supabase.from('bills').delete().eq('id', id));

export const registerPayment = async ({ billId, amount, paidOn, method, notes }) =>
  must(await supabase.rpc('register_payment', { p_bill: billId, p_amount: amount, p_paid_on: paidOn, p_method: method, p_notes: notes || null }));
export const createExpense = async ({ householdId, name, category, amount, date, method }) =>
  must(await supabase.rpc('create_expense', { p_household: householdId, p_name: name, p_category: category, p_amount: amount, p_date: date, p_method: method || 'Efectivo' }));
export const listPayments = async billId => must(await supabase.from('payments').select('*').eq('bill_id', billId).order('paid_on'));
export const deletePayment = async id => must(await supabase.from('payments').delete().eq('id', id));

/* Comprobantes privados: ruta <hogar>/<factura>/<uuid>-<nombre>; se leen con URLs firmadas de corta vida */
export async function uploadFile(hid, billId, file) {
  const safe = file.name.replace(/[^A-Za-z0-9._-]/g, '_').slice(-80);
  const path = `${hid}/${billId}/${crypto.randomUUID()}-${safe}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return path;
}
export const removeFile = async path => must(await supabase.storage.from(BUCKET).remove([path]));
export const addAttachment = async row => must(await supabase.from('bill_attachments').insert(row).select().single());
export const listAttachments = async billId => must(await supabase.from('bill_attachments').select('*').eq('bill_id', billId).order('created_at'));
export async function signedUrl(path, seconds = 300) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, seconds);
  if (error) throw error;
  return data.signedUrl;
}
