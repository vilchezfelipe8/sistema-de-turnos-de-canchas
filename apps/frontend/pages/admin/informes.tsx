import { useRouter } from 'next/router';
import AdminRouteShell from '../../components/admin/AdminRouteShell';
import AdminTabStatistics from '../../components/admin/AdminTabStatistics';
import { AdminSegmentedControl } from '../../components/admin/ui';
import { getActiveClubSlug, normalizeSessionUser } from '../../utils/session';

type ReportsTab = 'resumen' | 'reservas' | 'ingresos' | 'pendientes' | 'pos';

const REPORT_TABS: Array<{ value: ReportsTab; label: string }> = [
  { value: 'resumen', label: 'Resumen' },
  { value: 'ingresos', label: 'Ingresos' },
  { value: 'reservas', label: 'Reservas' },
  { value: 'pendientes', label: 'Pendientes' },
  { value: 'pos', label: 'POS' },
];

const parseReportsTab = (value: unknown): ReportsTab => {
  const raw = String(value || '').toLowerCase();
  if (raw === 'ingresos') return 'ingresos';
  if (raw === 'reservas') return 'reservas';
  if (raw === 'pendientes') return 'pendientes';
  if (raw === 'pos') return 'pos';
  return 'resumen';
};

export default function AdminReportsPage() {
  const router = useRouter();
  const activeTab = parseReportsTab(router.query.tab);

  const handleChangeTab = (nextTab: ReportsTab) => {
    if (nextTab === activeTab) return;
    void router.replace(
      {
        pathname: '/admin/informes',
        query: { ...router.query, tab: nextTab },
      },
      undefined,
      { shallow: true }
    );
  };

  return (
    <AdminRouteShell title="Informes | Pique Admin" activeItem="Informes" fromPath="/admin/informes" requiredAccess="operator">
      {(user) => {
        const userSlug = getActiveClubSlug(normalizeSessionUser(user as any));

        return (
          <div className="flex h-full min-h-0 flex-col gap-4 p-4 pb-0 lg:p-6 lg:pb-0">
            <AdminSegmentedControl
              options={REPORT_TABS.map((tab) => ({ value: tab.value, label: tab.label }))}
              value={activeTab}
              onChange={(value) => handleChangeTab(value as ReportsTab)}
              ariaLabel="Subnavegacion de informes"
              className="w-fit"
            />
            <section className="min-h-0 flex-1 overflow-y-auto pb-6 lg:pb-8">
              {activeTab === 'resumen' && (
                userSlug ? (
                  <AdminTabStatistics slugProp={userSlug} focus="resumen" />
                ) : (
                  <div className="rounded-xl border border-p-border bg-p-surface p-4 text-[13px] text-p-text-muted">
                    No se encontró el club activo para cargar los informes.
                  </div>
                )
              )}

              {activeTab !== 'resumen' && userSlug && (
                <AdminTabStatistics slugProp={userSlug} focus={activeTab} />
              )}

              {activeTab !== 'resumen' && !userSlug && (
                <div className="rounded-xl border border-p-border bg-p-surface p-4 text-[13px] text-p-text-muted">
                  No se encontró el club activo para cargar los informes.
                </div>
              )}
            </section>
          </div>
        );
      }}
    </AdminRouteShell>
  );
}
