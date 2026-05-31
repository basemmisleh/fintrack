/**
 * Storage abstraction.
 * - If Supabase is configured → reads/writes to Supabase (cross-device sync).
 * - Otherwise → falls back to localStorage (single-device).
 */
import { supabase } from "./supabase.js";

// A stable anonymous user ID stored in localStorage.
// This lets Supabase row-level isolation work without a login screen.
function getUserId() {
  let id = localStorage.getItem("ft_uid");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("ft_uid", id);
  }
  return id;
}

export const storage = {
  async get(key) {
    if (supabase) {
      const uid = getUserId();
      const { data, error } = await supabase
        .from("fintrack_data")
        .select("value")
        .eq("id", `${uid}:${key}`)
        .maybeSingle();
      if (error) throw error;
      return data ? { value: JSON.stringify(data.value) } : null;
    }
    // localStorage fallback
    const raw = localStorage.getItem(`ft_${key}`);
    return raw ? { value: raw } : null;
  },

  async set(key, value) {
    if (supabase) {
      const uid = getUserId();
      const { error } = await supabase
        .from("fintrack_data")
        .upsert({ id: `${uid}:${key}`, value: JSON.parse(value), updated_at: new Date().toISOString() });
      if (error) throw error;
      return;
    }
    // localStorage fallback
    localStorage.setItem(`ft_${key}`, value);
  }
};
