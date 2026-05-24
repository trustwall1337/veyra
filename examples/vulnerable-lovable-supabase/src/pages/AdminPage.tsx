import { useEffect, useState } from 'react';

import { supabase } from '../lib/supabase-client';

// cc-11-2 — Admin route without a server-side role check.
// The route renders an admin-only list. There is no `is_admin` predicate on
// the query and no server RPC that verifies the caller's role.
export function AdminPage() {
  const [rows, setRows] = useState<Array<{ id: string; email: string; role: string }>>([]);

  useEffect(() => {
    void supabase
      .from('users')
      .select('id, email, role')
      .then((res) => {
        if (res.data) setRows(res.data);
      });
  }, []);

  return (
    <section>
      <h1>Admin: all users</h1>
      <ul>
        {rows.map((u) => (
          <li key={u.id}>
            {u.email} — {u.role}
          </li>
        ))}
      </ul>
    </section>
  );
}
