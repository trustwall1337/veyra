import { createClient } from '@supabase/supabase-js';

import { SUPABASE_SERVICE_ROLE_KEY_FAKE } from './secrets';

// cc-11-7 — Client-side use of a privileged Supabase key.
// The client bundle reads VITE_SUPABASE_SERVICE_ROLE_KEY (a service-role token)
// from import.meta.env and passes it to createClient on the BROWSER side. The
// service-role key bypasses RLS; it must never reach the client. The correct
// pattern is the anon key on the client and the service-role key only on a
// trusted server.
const url = import.meta.env.VITE_SUPABASE_URL as string;
const serviceRoleKey =
  (import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY as string | undefined) ??
  SUPABASE_SERVICE_ROLE_KEY_FAKE;

export const supabase = createClient(url, serviceRoleKey);
