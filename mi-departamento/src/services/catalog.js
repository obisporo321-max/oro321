import { supabase } from '../lib/supabase.js';
const must = ({ data, error }) => { if (error) throw error; return data; };

export const list = async () => must(await supabase.from('services').select('*').order('name'));
export const create = async (hid, s) => must(await supabase.from('services')
  .insert({ household_id: hid, name: s.name, company: s.company || null, category: s.category, description: s.description || null }).select().single());
export const update = async (id, s) => must(await supabase.from('services')
  .update({ name: s.name, company: s.company || null, category: s.category, description: s.description || null }).eq('id', id).select().single());
export const setArchived = async (id, archived) => must(await supabase.from('services')
  .update({ archived_at: archived ? new Date().toISOString() : null }).eq('id', id).select().single());
