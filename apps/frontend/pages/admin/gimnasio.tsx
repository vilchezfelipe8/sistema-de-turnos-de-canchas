import { useRouter } from 'next/router';
import AdminRouteShell from '../../components/admin/AdminRouteShell';
import { AdminPage } from '../../components/admin/ui';
import GymTodayPanel from '../../modules/gimnasio/components/GymTodayPanel';
import GymMembersPanel from '../../modules/gimnasio/components/GymMembersPanel';
import { getActiveClubSlug, hasAdminAccess, normalizeSessionUser } from '../../utils/session';

type GymTab = 'hoy' | 'abonados';

const GYM_TABS: Array<{ value: GymTab; label: string }> = [
  { value: 'hoy', label: 'Hoy' },
  { value: 'abonados', label: 'Abonados' },
];

const parseGymTab = (value: unknown): GymTab => (String(value || '').toLowerCase() === 'abonados' ? 'abonados' : 'hoy');

/** Lo de todos los días del gimnasio. La configuración (turnero, planes) queda en Ajustes. */
export default function AdminGymPage() {
  const router = useRouter();
  const activeTab = parseGymTab(router.query.tab);

  const handleChangeTab = (nextTab: GymTab) => {
    if (nextTab === activeTab) return;
    void router.replace({ pathname: '/admin/gimnasio', query: { ...router.query, tab: nextTab } }, undefined, { shallow: true });
  };

  return (
    <AdminRouteShell title="Gimnasio | Pique Admin" activeItem="Gimnasio" fromPath="/admin/gimnasio">
      {(user) => {
        const normalized = normalizeSessionUser(user as any);
        const clubSlug = getActiveClubSlug(normalized) || '';
        return (
          <AdminPage
            title="Gimnasio"
            description="Turnos, ingresos y abonados."
            tabs={{
              options: GYM_TABS,
              value: activeTab,
              onChange: (value) => handleChangeTab(value as GymTab),
              ariaLabel: 'Secciones del gimnasio',
            }}
          >
            {activeTab === 'hoy' && <GymTodayPanel clubSlug={clubSlug} />}
            {activeTab === 'abonados' && <GymMembersPanel clubSlug={clubSlug} canManage={hasAdminAccess(normalized)} />}
          </AdminPage>
        );
      }}
    </AdminRouteShell>
  );
}
