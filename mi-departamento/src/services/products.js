import { supabase } from '../lib/supabase.js';
const must = ({ data, error }) => { if (error) throw error; return data; };

export const list = async () => must(await supabase.from('products').select('*').order('name'));
export const create = async (hid, p) => must(await supabase.from('products')
  .insert({ household_id: hid, name: p.name, emoji: p.emoji, category: p.category }).select().single());
export const setNeedsPurchase = async (id, value) =>
  must(await supabase.from('products').update({ needs_purchase: value }).eq('id', id).select().single());
export const remove = async id => must(await supabase.from('products').delete().eq('id', id));
export const seedStarter = async hid => must(await supabase.rpc('seed_starter_products', { p_household: hid }));
