import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    "Brak VITE_SUPABASE_URL lub VITE_SUPABASE_ANON_KEY. Sprawdź plik .env (lokalnie) lub zmienne środowiskowe w Vercel."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
