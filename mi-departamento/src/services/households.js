import { supabase } from '../lib/supabase.js';
const must = ({ data, error }) => { if (error) throw error; return data; };

export async function getMine(userId) {
  const row = must(await supabase.from('household_members')
    .select('role, display_name, household:households(id, name, address, address_confirmed)')
    .eq('user_id', userId).maybeSingle());
  return row && row.household ? { ...row.household, role: row.role, displayName: row.display_name } : null;
}
export const listMembers = async hid =>
  must(await supabase.from('household_members').select('user_id, role, display_name, joined_at').eq('household_id', hid).order('joined_at'));
export const update = async (hid, patch) =>
  must(await supabase.from('households').update(patch).eq('id', hid).select().single());
export const create = async (name, displayName) =>
  must(await supabase.rpc('create_household', { p_name: name, p_display_name: displayName }));
export const joinWithCode = async (code, displayName) =>
  must(await supabase.rpc('join_household_with_code', { p_code: code, p_display_name: displayName }));
export const createInvite = async (hid, email) =>
  must(await supabase.rpc('create_household_invite', { p_household: hid, p_email: email || null }));
