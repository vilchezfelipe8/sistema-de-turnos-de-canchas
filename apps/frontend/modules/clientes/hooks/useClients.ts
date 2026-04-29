import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClientService } from '../../../services/ClientService';
import { getActiveClubSlug, normalizeSessionUser } from '../../../utils/session';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape returned by ClientService.listDebtors for each client row. */
export type AdminClient = {
  id: string | number;
  name: string;
  phone: string;
  dni: string;
  email: string;
  isProfessor: boolean;
  totalBookings: number;
  totalDebt: number;
  lastBookingAt: string | null;
  nextBookingAt: string | null;
  /** Account history entries (open + closed accounts for this client). */
  history: any[];
  /** Booking history entries. */
  bookings: any[];
};

export type ClientScope = 'all' | 'debt_open';

type UseClientsOptions = {
  /** Override the active club slug. Falls back to the context value. */
  clubSlug?: string;
  scope?: ClientScope;
};

type UseClientsReturn = {
  /** Full client list (unfiltered). */
  clients: AdminClient[];
  /** Clients filtered by `searchTerm`. */
  filteredClients: AdminClient[];
  loading: boolean;
  error: string;
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  scope: ClientScope;
  setScope: (scope: ClientScope) => void;
  reload: () => Promise<void>;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * useClients — carga y filtra el directorio de clientes del club activo.
 *
 * @example
 * const { filteredClients, loading, searchTerm, setSearchTerm } = useClients();
 */
export function useClients(options: UseClientsOptions = {}): UseClientsReturn {
  const [clients, setClients] = useState<AdminClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [scope, setScope] = useState<ClientScope>(options.scope ?? 'all');

  const resolvedSlug =
    options.clubSlug ?? getActiveClubSlug(normalizeSessionUser(null)) ?? undefined;

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const data = await ClientService.listDebtors(resolvedSlug, { scope });
      setClients(data as AdminClient[]);
    } catch (err: any) {
      setError(err?.message ?? 'No se pudo cargar la lista de clientes.');
    } finally {
      setLoading(false);
    }
  }, [resolvedSlug, scope]);

  // Reload whenever scope changes.
  useEffect(() => {
    void load();
  }, [load]);

  const filteredClients = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return clients;
    return clients.filter(
      (c) =>
        c.name.toLowerCase().includes(term) ||
        (c.phone && c.phone.includes(term)) ||
        (c.dni && c.dni !== '-' && c.dni.toLowerCase().includes(term)) ||
        (c.email && c.email.toLowerCase().includes(term))
    );
  }, [clients, searchTerm]);

  return {
    clients,
    filteredClients,
    loading,
    error,
    searchTerm,
    setSearchTerm,
    scope,
    setScope,
    reload: load,
  };
}
