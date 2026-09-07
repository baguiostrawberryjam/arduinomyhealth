import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api.js';
import { navigate, usePath } from './router.js';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Dashboard from './pages/Dashboard.jsx';
import AdminUsers from './pages/AdminUsers.jsx';

const PUBLIC_PATHS = ['/login', '/register'];

/** /admin/user/5 -> 5. Any other path -> null. */
function adminUserId(path) {
  const match = /^\/admin\/user\/(\d+)$/.exec(path);
  return match ? Number(match[1]) : null;
}

export default function App() {
  const path = usePath();
  const [me, setMe] = useState(null);
  const [booting, setBooting] = useState(true);

  // One /api/me call decides both "who is this" and "are they logged in".
  const refreshMe = useCallback(async () => {
    try {
      const profile = await api.me();
      setMe(profile);
      return profile;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setMe(null);
        return null;
      }
      throw err;
    }
  }, []);

  useEffect(() => {
    refreshMe()
      .catch(() => setMe(null))
      .finally(() => setBooting(false));
  }, [refreshMe]);

  // Keep the URL and the auth state in agreement, whichever one moved.
  useEffect(() => {
    if (booting) return;
    const isPublic = PUBLIC_PATHS.includes(path);
    if (me && isPublic) navigate('/', { replace: true });
    else if (!me && !isPublic) navigate('/login', { replace: true });
    else if (me && !me.isAdmin && path.startsWith('/admin')) navigate('/', { replace: true });
  }, [booting, me, path]);

  const handleLogout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setMe(null);
      navigate('/login', { replace: true });
    }
  }, []);

  if (booting) {
    return (
      <div className="boot">
        <span className="spinner" aria-hidden="true" />
        <span className="sr-only">Loading</span>
      </div>
    );
  }

  if (!me) {
    return path === '/register' ? (
      <Register onAuthenticated={refreshMe} />
    ) : (
      <Login onAuthenticated={refreshMe} />
    );
  }

  // The endpoints check admin rights for themselves; this only keeps a
  // non-admin who typed /admin from staring at a page that can only 403.
  if (path.startsWith('/admin') && me.isAdmin) {
    return <AdminUsers me={me} onLogout={handleLogout} viewUserId={adminUserId(path)} />;
  }

  return <Dashboard me={me} onLogout={handleLogout} />;
}
