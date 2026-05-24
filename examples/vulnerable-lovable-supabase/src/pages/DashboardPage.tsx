import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { supabase } from '../lib/supabase-client';

// cc-11-4 — Query uses client-provided tenant_id from URL params.
// The tenant scope is read straight off ?tenant_id=… without server validation
// that the caller belongs to that tenant.
export function DashboardPage() {
  const [params] = useSearchParams();
  const tenantId = params.get('tenant_id');
  const [docs, setDocs] = useState<Array<{ id: string; body: string }>>([]);

  useEffect(() => {
    if (!tenantId) return;
    void supabase
      .from('documents')
      .select('id, body')
      .eq('tenant_id', tenantId)
      .then((res) => {
        if (res.data) setDocs(res.data);
      });
  }, [tenantId]);

  return (
    <section>
      <h1>Documents for tenant {tenantId}</h1>
      <ul>
        {docs.map((d) => (
          <li key={d.id}>{d.body}</li>
        ))}
      </ul>
    </section>
  );
}
