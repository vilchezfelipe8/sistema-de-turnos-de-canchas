import type { ReactNode, Ref } from 'react';
import AdminSegmentedControl from './AdminSegmentedControl';

export type AdminPageTabs = {
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
};

type AdminPageHeaderProps = {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  tabs?: AdminPageTabs;
};

/** Encabezado único de las secciones del admin: título, bajada, acciones y pestañas. */
export function AdminPageHeader({ title, description, actions, tabs }: AdminPageHeaderProps) {
  return (
    <header className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold tracking-[-0.02em] text-p-text">{title}</h1>
          {description && <p className="mt-0.5 text-[13px] leading-5 text-p-text-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {tabs && (
        <AdminSegmentedControl
          options={tabs.options}
          value={tabs.value}
          onChange={tabs.onChange}
          ariaLabel={tabs.ariaLabel}
          className="w-fit"
        />
      )}
    </header>
  );
}

type AdminPageProps = AdminPageHeaderProps & {
  children: ReactNode;
  /** Avisos entre el encabezado y el contenido. */
  notice?: ReactNode;
  /**
   * 'page' (default): el contenido scrollea dentro de la página.
   * 'fill': el contenido ocupa el alto disponible y maneja su propio scroll (maestro-detalle).
   */
  layout?: 'page' | 'fill';
  contentRef?: Ref<HTMLElement>;
};

/**
 * Marco de todas las secciones del admin: mismos márgenes, mismo encabezado,
 * mismas pestañas. El contenido va adentro sin padding propio.
 */
export default function AdminPage({ title, description, actions, tabs, notice, layout = 'page', contentRef, children }: AdminPageProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-4 px-4 pt-4 lg:px-6 lg:pt-6">
        <AdminPageHeader title={title} description={description} actions={actions} tabs={tabs} />
        {notice}
      </div>
      <section
        ref={contentRef}
        className={
          layout === 'fill'
            ? 'flex min-h-0 flex-1 flex-col px-4 pb-4 pt-4 lg:px-6 lg:pb-6'
            : 'min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-4 lg:px-6'
        }
      >
        {children}
      </section>
    </div>
  );
}
