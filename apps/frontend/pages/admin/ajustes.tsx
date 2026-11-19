import { useRouter } from 'next/router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import AdminRouteShell from '../../components/admin/AdminRouteShell';
import AdminSettingsWorkspace from '../../modules/ajustes/components/AdminSettingsWorkspace';
import {
  SETTINGS_GROUPS,
  getSettingsTabMeta,
  parseSettingsTab,
  type SettingsTab,
} from '../../modules/ajustes/settingsNav';

export default function AdminSettingsV2Page() {
  const router = useRouter();
  const activeTab = parseSettingsTab(router.query.tab);
  const hasExplicitTab = typeof router.query.tab === 'string' && router.query.tab.trim() !== '';
  const showMobileIndex = router.isReady && !hasExplicitTab;
  const activeTabLabel = getSettingsTabMeta(activeTab).label;

  const handleBackToMobileIndex = () => {
    const restQuery = { ...router.query };
    delete restQuery.tab;
    void router.replace({ pathname: '/admin/ajustes', query: restQuery }, undefined, { shallow: true });
  };

  const handleChangeTab = (nextTab: SettingsTab) => {
    if (nextTab === activeTab && router.query.tab === nextTab) return;
    void router.replace(
      {
        pathname: '/admin/ajustes',
        query: { ...router.query, tab: nextTab },
      },
      undefined,
      { shallow: true }
    );
  };

  return (
    <AdminRouteShell title="Ajustes | Pique Admin" activeItem="Ajustes" fromPath="/admin/ajustes">
      <div className="flex h-full min-h-0 flex-col gap-3 p-3.5 pb-0 lg:gap-4 lg:p-6 lg:pb-0">
        {showMobileIndex ? (
          <h1 className="text-[22px] font-extrabold tracking-[-0.03em] text-p-text lg:hidden">Ajustes</h1>
        ) : (
          <div className="flex items-center gap-2.5 lg:hidden">
            <button
              type="button"
              onClick={handleBackToMobileIndex}
              aria-label="Volver a ajustes"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-p-border bg-p-surface text-p-text-secondary"
            >
              <ChevronLeft size={17} />
            </button>
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-p-text-muted">Ajustes</p>
              <h1 className="truncate text-[18px] font-extrabold tracking-[-0.02em] text-p-text">{activeTabLabel}</h1>
            </div>
          </div>
        )}
        {showMobileIndex && (
          <section className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-6 lg:hidden">
            {SETTINGS_GROUPS.map((group) => (
              <div key={group.title}>
                <p className="mb-2 text-[11px] font-bold text-p-text-muted">{group.title}</p>
                <div className="overflow-hidden rounded-2xl border border-p-border bg-p-surface">
                  {group.items.map((item, index) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => handleChangeTab(item.value)}
                        className={`flex min-h-[56px] w-full items-center gap-3 px-3.5 py-2.5 text-left transition hover:bg-p-surface-2 ${
                          index < group.items.length - 1 ? 'border-b border-p-border' : ''
                        }`}
                      >
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-p-surface-2 text-p-accent">
                          <Icon size={16} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[14px] font-semibold text-p-text">{item.label}</span>
                          <span className="block truncate text-[11px] text-p-text-muted">{item.hint}</span>
                        </span>
                        <ChevronRight size={16} className="shrink-0 text-p-text-muted" />
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>
        )}
        <div className={`min-h-0 flex-1 gap-8 lg:grid lg:grid-cols-[236px_minmax(0,1fr)] ${showMobileIndex ? 'max-lg:hidden' : ''}`}>
          <nav aria-label="Secciones de ajustes" className="hidden min-h-0 overflow-y-auto pb-6 lg:block">
            <h1 className="mb-5 px-2 text-[22px] font-extrabold tracking-[-0.03em] text-p-text">Ajustes</h1>
            <div className="space-y-5">
              {SETTINGS_GROUPS.map((group) => (
                <div key={`desk-${group.title}`}>
                  <p className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide text-p-text-muted">{group.title}</p>
                  <ul className="space-y-0.5">
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const active = item.value === activeTab;
                      return (
                        <li key={`desk-${item.value}`}>
                          <button
                            type="button"
                            aria-current={active ? 'page' : undefined}
                            title={item.hint}
                            onClick={() => handleChangeTab(item.value)}
                            className={`group relative flex w-full items-center gap-2.5 rounded-lg border px-2 py-[6px] text-left text-[13px] transition ${
                              active
                                ? 'border-p-border bg-p-surface font-semibold text-p-text'
                                : 'border-transparent text-p-text-secondary hover:bg-p-surface-2 hover:text-p-text'
                            }`}
                          >
                            <span
                              className={`grid h-7 w-7 shrink-0 place-items-center rounded-md transition ${
                                active ? 'bg-p-accent/10 text-p-accent' : 'text-p-text-muted group-hover:text-p-text-secondary'
                              }`}
                            >
                              <Icon size={15} />
                            </span>
                            <span className="truncate">{item.label}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </nav>
          <section className="h-full min-h-0 overflow-y-auto pb-6 lg:pb-10 lg:pt-1">
            <AdminSettingsWorkspace tab={activeTab} />
          </section>
        </div>
      </div>
    </AdminRouteShell>
  );
}
