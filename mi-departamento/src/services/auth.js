import { supabase } from '../lib/supabase.js';

const must = ({ data, error }) => { if (error) throw error; return data; };

export const getSession = async () => must(await supabase.auth.getSession()).session;
export const getUser = async () => must(await supabase.auth.getUser()).user;
export const signUp = async (email, password) =>
  must(await supabase.auth.signUp({ email, password, options: { emailRedirectTo: location.origin } }));
export const signIn = async (email, password) => must(await supabase.auth.signInWithPassword({ email, password }));
export const signOut = async () => { const { error } = await supabase.auth.signOut(); if (error) throw error; };
export const resetPassword = async email =>
  must(await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin }));
export const updatePassword = async password => must(await supabase.auth.updateUser({ password }));
