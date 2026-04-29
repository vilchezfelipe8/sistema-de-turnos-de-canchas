import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import AdminRouteShell from '../../../components/admin/AdminRouteShell';
import { useClients } from '../../../modules/clientes/hooks/useClients';
import ClientsTable from '../../../modules/clientes/components/ClientsTable';
import ClientProfile from '../../../modules/clientes/components/ClientProfile';
import type { AdminClient } from '../../../modules/clientes/hooks/useClients';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * /admin/clientes/[id] — Perfil de cliente.
 *
 * Desktop: split view con listado a la izquierda (280 px) y perfil a la derecha.
 * Mobile: pantalla completa del perfil con botón ← Volver.
 */
export default function ClientePerfilPage() {
  const router = useRouter();
  const { id } = router.query;

  const { clients, filteredClients, loading, searchTerm, setSearchTerm } = useClients();

  const [selected, setSelected] = useState<AdminClient | null>(null);

  // Derive selected client from URL param once clients are loaded.
  useEffect(() => {
    if (!id || loading) return;
    const found = clients.find((c) => String(c.id) === String(id));
    setSelected(found ?? null);
  }, [id, clients, loading]);

  const handleRowClick = (client: AdminClient) => {
    void router.push(`/admin/clientes/${client.id}`);
  };

  const handleBack = () => {
    void router.push('/admin/clientes');
  };

  // TECH DEBT: this page derives the selected client by searching the full list loaded via
  // useClients(). That works because listDebtors already returns history[] per client.
  // Future improvement: add a dedicated endpoint GET /api/clubs/:slug/clients/:id that
  // returns a single client with full history, so this page doesn't need to load the whole
  // directory. Implement when the client list grows large enough to make that worthwhile.

  return (
    <AdminRouteShell title="Clientes" activeItem="Clientes" fromPath="/admin/clientes">
      <div className="flex h-full w-full overflow-hidden">

        {/* ── Left panel (desktop only) ── */}
        <div className="hidden w-[280px] shrink-0 flex-col overflow-hidden border-r border-[#dce2ee] bg-white md:flex">
          {/* Search */}
          <div className="shrink-0 border-b border-[#edf0f6] px-4 py-3">
            <input
              type="search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar cliente…"
              className="w-full rounded-lg border border-[#dce2ee] bg-[#f8f9fc] px-3 py-2 text-[13px] text-[#2a3245] placeholder-[#98a1b3] outline-none focus:border-[#3053e2] focus:bg-white"
            />
          </div>

          {/* Table */}
          <div className="flex-1 overflow-y-auto">
            <ClientsTable
              clients={filteredClients}
              loading={loading}
              onRowClick={handleRowClick}
              selectedId={id as string | undefined}
            />
          </div>
        </div>

        {/* ── Right panel / full screen mobile ── */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {loading && !selected ? (
            // Loading skeleton while client list is being fetched
            <div className="flex h-full items-center justify-center">
              <div className="space-y-3 text-center">
                <div className="mx-auto h-4 w-40 animate-pulse rounded bg-[#f0f2f7]" />
                <div className="mx-auto h-3 w-24 animate-pulse rounded bg-[#f0f2f7]" />
              </div>
            </div>
          ) : selected ? (
            // onEdit / onDelete are intentionally omitted here.
            // This route is a read-only profile view — edit and delete actions live
            // in the main /admin/clientes sidebar (clientes-playground2.tsx).
            // When that page gains a dedicated modal API, those handlers can be wired here too.
            <ClientProfile
              client={selected}
              onBack={handleBack}
            />
          ) : (
            // Client not found in list (wrong ID or not loaded yet)
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-[15px] font-semibold text-[#2a3245]">
                Cliente no encontrado
              </p>
              <p className="text-[13px] text-[#98a1b3]">
                El cliente que buscás no existe o no tenés acceso.
              </p>
              <button
                type="button"
                onClick={handleBack}
                className="mt-2 rounded-lg border border-[#dce2ee] bg-white px-4 py-2 text-[13px] font-medium text-[#6f7890] transition hover:bg-[#f5f6f8]"
              >
                ← Volver a Clientes
              </button>
            </div>
          )}
        </div>
      </div>
    </AdminRouteShell>
  );
}
