import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { Check } from 'lucide-react';
import AdminRouteShell from '../../components/admin/AdminRouteShell';
import { AdminSegmentedControl } from '../../components/admin/ui';
import { ClubAdminService } from '../../services/ClubAdminService';
import { getActiveClubSlug, normalizeSessionUser } from '../../utils/session';
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

/**
 * Primeros pasos: mientras la academia no tenga profesor, clase y alumnos, muestra
 * qué hacer y en qué orden. Desaparece sola cuando están los tres.
 */
function AcademyGettingStarted({
  clubSlug,
  refreshKey,
  currentTab,
  onGoTo,
}: {
  clubSlug: string;
  refreshKey: string;
  currentTab: AcademyTab;
  onGoTo: (tab: AcademyTab) => void;
}) {
  const [counts, setCounts] = useState<{ teachers: number; classes: number; students: number } | null>(null);

  useEffect(() => {
    if (!clubSlug) return;
    let cancelled = false;
    Promise.all([
      ClubAdminService.getTeachers(clubSlug, true).catch(() => []),
      ClubAdminService.getClassSessions(clubSlug).catch(() => []),
      ClubAdminService.getAcademyStudents(clubSlug, {}).catch(() => []),
    ]).then(([teachers, classes, students]) => {
      if (cancelled) return;
      setCounts({
        teachers: Array.isArray(teachers) ? teachers.length : 0,
        classes: Array.isArray(classes) ? classes.length : 0,
        students: Array.isArray(students) ? students.length : 0,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [clubSlug, refreshKey]);

  if (!counts || (counts.teachers > 0 && counts.classes > 0 && counts.students > 0)) return null;

  const steps: Array<{ key: string; done: boolean; title: string; text: string; action: string; here: string; tab: AcademyTab }> = [
    {
      key: 'teacher',
      done: counts.teachers > 0,
      title: 'Sumá un profesor',
      text: 'Quién da las clases.',
      action: 'Ir a Profesores',
      here: 'Tocá "Nuevo profesor" acá abajo.',
      tab: 'profesores',
    },
    {
      key: 'class',
      done: counts.classes > 0,
      title: 'Creá una clase',
      text: 'Día, hora, cancha, cupo y precio.',
      action: 'Ir a Clases',
      here: 'Tocá "Nueva clase" acá abajo.',
      tab: 'clases',
    },
    {
      key: 'students',
      done: counts.students > 0,
      title: 'Anotá alumnos',
      text: 'Desde la clase, o vendiéndoles un pack.',
      action: 'Ir a Clases',
      here: 'Abrí una clase de la lista y anotalos.',
      tab: 'clases',
    },
  ];
  const nextIndex = steps.findIndex((step) => !step.done);

  return (
    <div className="rounded-2xl border border-p-border bg-p-surface p-4">
      <p className="text-[15px] font-semibold text-p-text">Empezá la academia en 3 pasos</p>
      <ol className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
        {steps.map((step, index) => {
          const isNext = index === nextIndex;
          return (
            <li
              key={step.key}
              className={`flex items-start gap-3 rounded-xl border px-3 py-3 ${
                isNext ? 'border-ink-900 bg-p-surface-2' : 'border-p-border'
              }`}
            >
              <span
                className={`grid h-7 w-7 flex-none place-items-center rounded-full text-[13px] font-bold ${
                  step.done ? 'bg-p-positive-bg text-p-positive' : isNext ? 'bg-ink-900 text-ink-50' : 'bg-p-surface-3 text-p-text-muted'
                }`}
              >
                {step.done ? <Check size={15} /> : index + 1}
              </span>
              <div className="min-w-0">
                <p className={`text-[14px] font-semibold ${step.done ? 'text-p-text-muted line-through' : 'text-p-text'}`}>{step.title}</p>
                <p className="text-[12px] text-p-text-muted">{step.text}</p>
                {isNext && step.tab === currentTab && (
                  <p className="mt-1.5 text-[13px] font-semibold text-p-text-secondary">{step.here}</p>
                )}
                {isNext && step.tab !== currentTab && (
                  <button
                    type="button"
                    onClick={() => onGoTo(step.tab)}
                    className="mt-1.5 text-[13px] font-semibold text-p-accent hover:underline underline-offset-2"
                  >
                    {step.action} →
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

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
          <AcademyGettingStarted
            clubSlug={getActiveClubSlug(normalizeSessionUser(user as any)) || ''}
            refreshKey={activeTab}
            currentTab={activeTab}
            onGoTo={handleChangeTab}
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
