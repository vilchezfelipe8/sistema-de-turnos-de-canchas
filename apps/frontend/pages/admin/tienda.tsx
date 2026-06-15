import { useRouter } from 'next/router';
import AdminRouteShell from '../../components/admin/AdminRouteShell';
import AdminTabProducts from '../../components/admin/AdminTabProducts';
import AdminTabServices from '../../components/admin/AdminTabServices';
import AdminComingSoonPanel from '../../components/admin/AdminComingSoonPanel';
import { AdminSegmentedControl } from '../../components/admin/ui';
import { getActiveClubSlug, normalizeSessionUser } from '../../utils/session';

type StoreTab = 'productos' | 'servicios' | 'inventario';

const STORE_TABS: Array<{ value: StoreTab; label: string; comingSoon?: boolean }> = [
  { value: 'productos', label: 'Productos' },
  { value: 'servicios', label: 'Servicios' },
  { value: 'inventario', label: 'Inventario', comingSoon: true },
];

const parseStoreTab = (value: unknown): StoreTab => {
  const raw = String(value || '').toLowerCase();
  if (raw === 'servicios') return 'servicios';
  if (raw === 'inventario') return 'inventario';
  return 'productos';
};

export default function AdminStorePage() {
  const router = useRouter();
  const activeTab = parseStoreTab(router.query.tab);

  const handleChangeTab = (nextTab: StoreTab) => {
    if (nextTab === activeTab) return;
    void router.replace(
      {
        pathname: '/admin/tienda',
        query: { ...router.query, tab: nextTab },
      },
      undefined,
      { shallow: true }
    );
  };

  return (
    <AdminRouteShell title="Tienda | Pique Admin" activeItem="Tienda" fromPath="/admin/tienda">
      {(user) => {
        const normalizedUser = normalizeSessionUser(user as any);
        const clubSlug = getActiveClubSlug(normalizedUser);

        return (
          <div className="flex h-full min-h-0 flex-col gap-4 p-4 pb-0 lg:p-6 lg:pb-0">
            <AdminSegmentedControl
              options={STORE_TABS.map((tab) => ({ value: tab.value, label: tab.label }))}
              value={activeTab}
              onChange={(value) => handleChangeTab(value as StoreTab)}
              ariaLabel="Subnavegacion de tienda"
              className="w-fit"
            />
            <section className="min-h-0 flex-1 overflow-y-auto pb-6 lg:pb-8">
              {activeTab === 'productos' && <AdminTabProducts clubSlug={clubSlug || undefined} />}
              {activeTab === 'servicios' && <AdminTabServices clubSlug={clubSlug || undefined} />}
              {activeTab === 'inventario' && (
                <AdminComingSoonPanel
                  title="Inventario"
                  description="El inventario consolidado de tienda va a vivir en este modulo, con stock por producto y alertas de reposicion."
                />
              )}
            </section>
          </div>
        );
      }}
    </AdminRouteShell>
  );
}
