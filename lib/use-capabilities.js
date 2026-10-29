'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiJson } from '@/lib/authed-fetch.js';
import { isAdminLike } from '@/lib/roles.js';

/** Dynamic permissions for the signed-in user. Admin is always unrestricted. */
export function useCapabilities() {
  const [state, setState] = useState({ role: null, capabilities: {}, loading: true });

  const reload = useCallback(async () => {
    try {
      const data = await apiJson('/api/auth/capabilities');
      setState({ role: data.role, capabilities: data.capabilities || {}, loading: false });
    } catch {
      setState((current) => ({ ...current, loading: false }));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiJson('/api/auth/capabilities')
      .then((data) => {
        if (!cancelled) setState({ role: data.role, capabilities: data.capabilities || {}, loading: false });
      })
      .catch(() => {
        if (!cancelled) setState((current) => ({ ...current, loading: false }));
      });
    return () => { cancelled = true; };
  }, []);

  const can = useCallback(
    (key) => isAdminLike(state.role) || state.capabilities[key] === true,
    [state.role, state.capabilities]
  );
  return { ...state, can, reload };
}
