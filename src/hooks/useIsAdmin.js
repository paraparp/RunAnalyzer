import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

// ============================================================================
// ¿El usuario actual es admin?
//
// La respuesta la da el servidor (RPC `is_admin()`, que solo mira auth.uid()):
// ni el email ni una lista de admins viajan en el bundle. Y aunque alguien
// forzase este hook a `true` desde la consola, solo vería el enlace: /api/admin
// revalida el rol en cada request.
// ============================================================================
export default function useIsAdmin() {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.rpc('is_admin')
      .then(({ data, error }) => {
        if (active) setIsAdmin(!error && data === true);
      })
      .catch(() => { if (active) setIsAdmin(false); });
    return () => { active = false; };
  }, []);

  return isAdmin;
}
