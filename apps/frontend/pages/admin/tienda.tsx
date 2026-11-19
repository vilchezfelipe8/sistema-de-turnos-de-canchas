import { useRouter } from 'next/router';
import AdminRouteShell from '../../components/admin/AdminRouteShell';
import AdminTabProducts from '../../components/admin/AdminTabProducts';
import AdminTabServices from '../../components/admin/AdminTabServices';
import InventoryPage from '../../modules/tienda/components/InventoryPage';
import { AdminPage } from '../../components/admin/ui';
import { getActiveClubSlug, normalizeSessionUser } from '../../utils/session';

type StoreTab = 'productos' | 'servicios' | 'inventario';

const STORE_TABS: Array<{ value: StoreTab; label: string; comingSoon?: boolean }> = [
  { value: 'productos', label: 'Productos' },
  { value: 'servicios', label: 'Servicios' },
  { value: 'inventario', label: 'Inventario' },
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
          <AdminPage
            title="Tienda"
            description="Lo que vendés en el mostrador: productos, servicios y su stock."
            tabs={{
              options: STORE_TABS.map((tab) => ({ value: tab.value, label: tab.label })),
              value: activeTab,
              onChange: (value) => handleChangeTab(value as StoreTab),
              ariaLabel: 'Secciones de la tienda',
            }}
          >
              {activeTab === 'productos' && <AdminTabProducts clubSlug={clubSlug || undefined} />}
              {activeTab === 'servicios' && <AdminTabServices clubSlug={clubSlug || undefined} />}
              {activeTab === 'inventario' && <InventoryPage slug={clubSlug || undefined} />}
          </AdminPage>
        );
      }}
    </AdminRouteShell>
  );
}
