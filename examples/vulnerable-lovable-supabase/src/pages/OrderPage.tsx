import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { supabase } from '../lib/supabase-client';

// cc-11-3 — Direct object access by id from URL params.
// The query selects an order by id with no filter on the caller's user_id
// or tenant_id. Any signed-in user can read any order id they can guess.
export function OrderPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const [order, setOrder] = useState<unknown>(null);

  useEffect(() => {
    if (!orderId) return;
    void supabase
      .from('orders')
      .select('id, total_cents, user_id, tenant_id')
      .eq('id', orderId)
      .single()
      .then((res) => {
        setOrder(res.data);
      });
  }, [orderId]);

  return (
    <section>
      <h1>Order {orderId}</h1>
      <pre>{JSON.stringify(order, null, 2)}</pre>
    </section>
  );
}
