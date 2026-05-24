import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';

import { supabase } from './lib/supabase-client';

import { AdminPage } from './pages/AdminPage';
import { DashboardPage } from './pages/DashboardPage';
import { OrderPage } from './pages/OrderPage';

// cc-11-1 — Frontend-only protected route.
// Redirects on the client based on a local `user` state. No server-side check
// gates the rendered data; data fetches inside protected pages still run.
function RequireUser({ children }: { children: React.ReactNode }) {
  const [checked, setChecked] = useState(false);
  const [user, setUser] = useState<unknown>(null);
  const navigate = useNavigate();

  useEffect(() => {
    void supabase.auth.getUser().then((res) => {
      setUser(res.data.user);
      setChecked(true);
      if (!res.data.user) {
        navigate('/login');
      }
    });
  }, [navigate]);

  if (!checked) return <div>loading…</div>;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route
        path="/dashboard"
        element={
          <RequireUser>
            <DashboardPage />
          </RequireUser>
        }
      />
      <Route
        path="/orders/:orderId"
        element={
          <RequireUser>
            <OrderPage />
          </RequireUser>
        }
      />
      <Route
        path="/admin"
        element={
          <RequireUser>
            <AdminPage />
          </RequireUser>
        }
      />
      <Route path="/login" element={<div>login page</div>} />
    </Routes>
  );
}
