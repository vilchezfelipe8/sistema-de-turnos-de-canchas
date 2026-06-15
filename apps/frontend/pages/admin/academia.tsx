import { useRouter } from 'next/router';
import AdminRouteShell from '../../components/admin/AdminRouteShell';
import { AdminSegmentedControl } from '../../components/admin/ui';
import { AdminClassesPageContent } from './clases';
import { AdminAcademyStudentsPageContent } from './alumnos';
import { AdminTeachersPageContent } from './profesores';

type AcademyTab = 'clases' | 'alumnos' | 'profesores';

const ACADEMY_TABS: Array<{ value: AcademyTab; label: string }> = [
  { value: 'clases', label: 'Clases' },
  { value: 'alumnos', label: 'Alumnos' },
  { value: 'profesores', label: 'Profesores' },
];

const parseAcademyTab = (value: unknown): AcademyTab => {
  const raw = String(value || '').toLowerCase();
  if (raw === 'alumnos') return 'alumnos';
  if (raw === 'profesores') return 'profesores';
  return 'clases';
};

export default function AdminAcademyPage() {
  const router = useRouter();
  const activeTab = parseAcademyTab(router.query.tab);

  const handleChangeTab = (nextTab: AcademyTab) => {
    if (nextTab === activeTab) return;
    void router.replace(
      {
        pathname: '/admin/academia',
        query: { ...router.query, tab: nextTab },
      },
      undefined,
      { shallow: true }
    );
  };

  return (
    <AdminRouteShell title="Academia | Pique Admin" activeItem="Academia" fromPath="/admin/academia">
      {(user) => (
        <div className="flex h-full min-h-0 flex-col gap-3 p-4 pb-0 lg:p-6 lg:pb-0">
          <AdminSegmentedControl
            options={ACADEMY_TABS}
            value={activeTab}
            onChange={(value) => handleChangeTab(value as AcademyTab)}
            ariaLabel="Subnavegacion de Academia"
            className="w-fit"
            density="compact"
          />
          <section className="min-h-0 flex-1 pb-6 lg:pb-8">
            {activeTab === 'clases' && <AdminClassesPageContent user={user} embedded />}
            {activeTab === 'alumnos' && <AdminAcademyStudentsPageContent user={user} embedded />}
            {activeTab === 'profesores' && <AdminTeachersPageContent user={user} embedded />}
          </section>
        </div>
      )}
    </AdminRouteShell>
  );
}
