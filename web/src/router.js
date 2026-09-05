// A ~20-line router. There are three pages and the dependency list is fixed at
// four packages, so react-router would be the largest thing in the bundle for
// the least work. Express serves index.html for unknown paths (SPA fallback),
// so real URLs still work on refresh and on a shared link.
import { useEffect, useState } from 'react';

export function navigate(to, { replace = false } = {}) {
  if (window.location.pathname === to) return;
  window.history[replace ? 'replaceState' : 'pushState']({}, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const sync = () => setPath(window.location.pathname);
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  return path;
}
