import type { ReactNode } from 'react';
import { CalendarClock, CreditCard, GraduationCap, Layers3, Sparkles, UserRound } from 'lucide-react';

const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ');

export type AcademyBadgeTone =
  | 'neutral'
  | 'muted'
  | 'success'
  | 'danger'
  | 'warning'
  | 'info'
  | 'accent';

const academyBadgeToneClass: Record<AcademyBadgeTone, string> = {
  neutral: 'border-p-border bg-p-surface-2 text-p-text-secondary',
  muted: 'border-p-border bg-p-surface text-p-text-muted',
  success: 'border-p-positive/40 bg-p-positive-bg text-p-positive',
  danger: 'border-p-error/40 bg-p-error-bg text-[var(--error-fg)]',
  warning: 'border-amber-300/25 bg-amber-400/10 text-amber-200',
  info: 'border-sky-300/30 bg-sky-400/10 text-sky-100',
  accent: 'border-p-accent/35 bg-p-accent/10 text-p-accent',
};

export function academyPaymentLabel(status: string) {
  switch (status) {
    case 'UNPAID':
      return 'Pendiente';
    case 'PARTIAL':
      return 'Parcial';
    case 'PAID':
      return 'Pagado';
    case 'REFUNDED':
      return 'Devuelto';
    case 'COVERED_BY_CREDIT':
      return 'Cubierto con crédito';
    default:
      return status;
  }
}

export function academyPaymentTone(status: string): AcademyBadgeTone {
  switch (status) {
    case 'PAID':
      return 'success';
    case 'REFUNDED':
      return 'muted';
    case 'COVERED_BY_CREDIT':
      return 'info';
    case 'PARTIAL':
      return 'warning';
    case 'UNPAID':
    default:
      return 'neutral';
  }
}

export function academyAttendanceLabel(status: string) {
  switch (status) {
    case 'PENDING':
      return 'Pendiente';
    case 'ATTENDED':
      return 'Presente';
    case 'ABSENT':
      return 'Ausente';
    case 'NO_SHOW':
      return 'No asistió';
    case 'CANCELLED_ON_TIME':
      return 'Canceló a tiempo';
    case 'CANCELLED_LATE':
      return 'Canceló tarde';
    default:
      return status;
  }
}

export function academyAttendanceTone(status: string): AcademyBadgeTone {
  switch (status) {
    case 'ATTENDED':
      return 'success';
    case 'NO_SHOW':
    case 'ABSENT':
      return 'danger';
    case 'CANCELLED_LATE':
      return 'warning';
    case 'CANCELLED_ON_TIME':
      return 'muted';
    case 'PENDING':
    default:
      return 'neutral';
  }
}

export function academyEnrollmentLabel(status: string) {
  switch (status) {
    case 'ENROLLED':
      return 'Inscripto';
    case 'WAITLISTED':
      return 'En espera';
    case 'CANCELLED':
      return 'Cancelado';
    default:
      return status;
  }
}

export function academyEnrollmentTone(status: string): AcademyBadgeTone {
  switch (status) {
    case 'ENROLLED':
      return 'success';
    case 'WAITLISTED':
      return 'warning';
    case 'CANCELLED':
    default:
      return 'danger';
  }
}

export function academyPassStatusLabel(status: string) {
  switch (status) {
    case 'ACTIVE':
      return 'Activo';
    case 'EXPIRED':
      return 'Vencido';
    case 'DEPLETED':
      return 'Sin créditos';
    case 'CANCELLED':
      return 'Cancelado';
    default:
      return status;
  }
}

export function academyPassStatusTone(status: string): AcademyBadgeTone {
  switch (status) {
    case 'ACTIVE':
      return 'success';
    case 'EXPIRED':
      return 'warning';
    case 'DEPLETED':
      return 'muted';
    case 'CANCELLED':
    default:
      return 'danger';
  }
}

export function academyFinancialStateLabel(status: string) {
  switch (status) {
    case 'PENDING':
      return 'Pendiente';
    case 'PARTIAL':
      return 'Parcial';
    case 'PAID':
      return 'Pagado';
    case 'NO_ACCOUNT':
    default:
      return 'Sin cuenta';
  }
}

export function academyFinancialStateTone(status: string): AcademyBadgeTone {
  switch (status) {
    case 'PAID':
      return 'success';
    case 'PARTIAL':
      return 'warning';
    case 'PENDING':
      return 'accent';
    case 'NO_ACCOUNT':
    default:
      return 'muted';
  }
}

export function academySourceLabel(status: string) {
  switch (status) {
    case 'CLASS_PASS':
      return 'Pack de clases';
    case 'CLASS_ENROLLMENT':
      return 'Clase';
    case 'BOOKING':
      return 'Reserva';
    case 'BAR':
      return 'Bar';
    case 'TABLE':
      return 'Mesa';
    case 'MANUAL':
      return 'Manual';
    default:
      return status;
  }
}

export function AcademyStatusBadge({
  label,
  tone = 'neutral',
  icon,
  className,
}: {
  label: ReactNode;
  tone?: AcademyBadgeTone;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-none shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]',
        academyBadgeToneClass[tone],
        className
      )}
    >
      {icon}
      {label}
    </span>
  );
}

export function AcademyEmptyState({
  title,
  description,
  action,
  tone = 'neutral',
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  tone?: AcademyBadgeTone;
}) {
  const icon =
    tone === 'accent' ? <Sparkles size={16} /> : tone === 'info' ? <CreditCard size={16} /> : <Layers3 size={16} />;
  return (
    <div className="rounded-2xl border border-dashed border-p-border bg-p-surface px-4 py-5 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-2xl border border-p-border bg-p-surface-2 text-p-text-muted">
        {icon}
      </div>
      <p className="mt-3 text-[14px] font-semibold text-p-text">{title}</p>
      {description ? <p className="mx-auto mt-1 max-w-[420px] text-[12px] leading-relaxed text-p-text-muted">{description}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

const moduleIconByTab = {
  clases: <CalendarClock size={16} />,
  alumnos: <GraduationCap size={16} />,
  profesores: <UserRound size={16} />,
} as const;

export function AcademyModuleHeader({
  activeTab,
  title,
  description,
}: {
  activeTab: 'clases' | 'alumnos' | 'profesores';
  title: string;
  description: string;
}) {
  const meta = [
    'Operación diaria simple',
    'Créditos y pagos separados',
    'Cobro siempre por Cuentas',
  ];

  return (
    <section className="rounded-[24px] border border-p-border bg-p-surface px-5 py-5 shadow-p-card lg:px-6 lg:py-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 rounded-full border border-p-border bg-p-surface-2 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-p-text-muted">
            {moduleIconByTab[activeTab]}
            Academia
          </div>
          <h1 className="mt-3 text-[28px] font-semibold tracking-tight text-p-text">{title}</h1>
          <p className="mt-2 max-w-[720px] text-[13px] leading-relaxed text-p-text-secondary">{description}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {meta.map((item) => (
            <AcademyStatusBadge key={item} label={item} tone="muted" />
          ))}
        </div>
      </div>
    </section>
  );
}
