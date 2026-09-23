// Cliente Supabase compartilhado por todas as páginas.
// Requer que config.js tenha sido carregado antes deste script.
if (!window.SUPABASE_URL || window.SUPABASE_URL.includes("SEU-PROJETO")) {
  console.warn("Configure config.js com a URL e a anon key do seu projeto Supabase.");
}
const supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
