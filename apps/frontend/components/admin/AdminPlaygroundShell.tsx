import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import AdminToast from './AdminToast';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  MapPin,
  Calendar,
  Users,
  X,
} from 'lucide-react';
import { logout } from '../../services/AuthService';
import { useUserTheme } from '../../contexts/UserThemeContext';
import { getActiveClubSlug, hasAdminAccess, hasOperatorAccess, normalizeSessionUser, setActiveClubId } from '../../utils/session';
import { ADMIN_Z_INDEX } from '../../utils/adminZIndex';
import { PLAYGROUND_SIDEBAR_ITEMS } from './playgroundNavigation';
import PiqueLogo from '../PiqueLogo';

type AdminPlaygroundShellProps = {
  activeItem: string;
  children: ReactNode;
  contentMuted?: boolean;
  user: any;
};

const HELP_WHATSAPP_URL = 'https://wa.me/5493513436163';
const HELP_EMAIL_URL = 'mailto:soporte.pique@gmail.com';

const HELP_TIPS_BY_SECTION: Record<string, string[]> = {
  Calendario: [
    'Click en un bloque horario para crear una reserva rápida.',
    'Arrastrá una reserva para mover horario o cancha cuando haya disponibilidad.',
    'Usá las flechas de fecha para revisar días anteriores o próximos.',
  ],
  Clientes: [
    'Buscá clientes por nombre o teléfono para editar más rápido.',
    'Completá datos clave para evitar errores al cobrar o contactar.',
    'Revisá historial antes de crear duplicados.',
  ],
  Caja: [
    'Registra pagos parciales cuando no se abone el total.',
    'Verifica el responsable de cobro antes de confirmar.',
    'Usa la trazabilidad para auditar ajustes y movimientos.',
  ],
  Tienda: [
    'Centraliza productos y servicios con una misma logica operativa.',
    'Mantene items inactivos para conservar trazabilidad de ventas.',
    'Revisa stock y precios antes de abrir consumos o cobrar.',
  ],
  Informes: [
    'Revisa el resumen general antes de profundizar por categoria.',
    'Compara periodos para detectar caidas o picos de actividad.',
    'Usa filtros consistentes para evitar lecturas sesgadas.',
  ],
  Ajustes: [
    'Agrupa configuraciones por dominio para reducir errores operativos.',
    'Prioriza cambios desde panel lateral cuando el formulario es largo.',
    'Registra excepciones de agenda con contexto claro para soporte.',
  ],
};

const humanizeClubSlug = (value: unknown) => {
  const slug = String(value || '').trim();
  if (!slug) return '';
  return slug
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

export default function AdminPlaygroundShell({
  activeItem,
  children,
  contentMuted = false,
  user,
}: AdminPlaygroundShellProps) {
  const router = useRouter();
  const { isLight } = useUserTheme();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [clubMenuOpen, setClubMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [selectedClubId, setSelectedClubId] = useState<number>(0);
  const clubMenuRef = useRef<HTMLDivElement | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);

  const normalizedUser = useMemo(() => normalizeSessionUser(user || null), [user]);
  const hasAdminPrivileges = useMemo(() => hasAdminAccess(normalizedUser), [normalizedUser]);
  const hasOperatorPrivileges = useMemo(() => hasOperatorAccess(normalizedUser), [normalizedUser]);
  const adminClubSlug = useMemo(() => getActiveClubSlug(normalizedUser), [normalizedUser]);
  const visibleSidebarItems = useMemo(
    () =>
      PLAYGROUND_SIDEBAR_ITEMS.filter((item) => {
        if (item.minAccess === 'admin') return hasAdminPrivileges;
        return hasOperatorPrivileges;
      }),
    [hasAdminPrivileges, hasOperatorPrivileges]
  );
  const clubOptions = useMemo(
    () =>
      Array.isArray(normalizedUser?.memberships)
        ? normalizedUser.memberships.map((membership) => ({
            id: Number(membership.clubId),
            label: String(
              (membership as any)?.club?.name ||
                humanizeClubSlug((membership as any)?.club?.slug) ||
                `Club #${membership.clubId}`
            ),
          }))
        : [],
    [normalizedUser]
  );

  useEffect(() => {
    const activeClubId = Number(normalizedUser?.activeClubId || 0);
    if (Number.isInteger(activeClubId) && activeClubId > 0) {
      setSelectedClubId(activeClubId);
      return;
    }
    if (clubOptions[0]?.id) {
      setSelectedClubId(clubOptions[0].id);
    }
  }, [clubOptions, normalizedUser?.activeClubId]);

  useEffect(() => {
    if (!clubMenuOpen) return;

    const onDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && clubMenuRef.current && !clubMenuRef.current.contains(target)) {
        setClubMenuOpen(false);
      }
    };

    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setClubMenuOpen(false);
    };

    document.addEventListener('mousedown', onDocumentMouseDown);
    document.addEventListener('keydown', onDocumentKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocumentMouseDown);
      document.removeEventListener('keydown', onDocumentKeyDown);
    };
  }, [clubMenuOpen]);

  useEffect(() => {
    if (!profileMenuOpen) return;

    const onDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && profileMenuRef.current && !profileMenuRef.current.contains(target)) {
        setProfileMenuOpen(false);
      }
    };

    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setProfileMenuOpen(false);
    };

    document.addEventListener('mousedown', onDocumentMouseDown);
    document.addEventListener('keydown', onDocumentKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocumentMouseDown);
      document.removeEventListener('keydown', onDocumentKeyDown);
    };
  }, [profileMenuOpen]);

  useEffect(() => {
    if (!helpOpen) return;
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHelpOpen(false);
    };
    document.addEventListener('keydown', onDocumentKeyDown);
    return () => {
      document.removeEventListener('keydown', onDocumentKeyDown);
    };
  }, [helpOpen]);

  useLayoutEffect(() => {
    const nextLeft = isSidebarCollapsed ? '66px' : '168px';
    document.documentElement.style.setProperty('--admin-shell-sidebar-left', nextLeft);
    return () => {
      document.documentElement.style.removeProperty('--admin-shell-sidebar-left');
    };
  }, [isSidebarCollapsed]);

  const sidebarWidthClass = isSidebarCollapsed ? 'w-[66px]' : 'w-[168px]';
  const selectedClubLabel =
    clubOptions.find((club) => club.id === selectedClubId)?.label ||
    clubOptions[0]?.label ||
    'Seleccionar club';
  const userInitial =
    String(user?.firstName || user?.name || 'U')
      .trim()
      .charAt(0)
      .toUpperCase() || 'U';
  const sectionHelpTips = HELP_TIPS_BY_SECTION[activeItem] || HELP_TIPS_BY_SECTION.Calendario;

  const handleChangeActiveClub = (clubId: number) => {
    if (!Number.isInteger(clubId) || clubId <= 0) return;
    setSelectedClubId(clubId);
    setClubMenuOpen(false);
    setActiveClubId(clubId);
    window.setTimeout(() => window.location.reload(), 80);
  };

  return (
    <div className="h-screen w-full overflow-hidden bg-p-bg text-p-text pique-root">
      <div className="flex h-full w-full flex-col">
        <header className="relative flex h-16 items-center overflow-visible bg-p-surface border-b border-p-border px-4 lg:px-6" style={{ zIndex: ADMIN_Z_INDEX.shellHeader }}>
          <div className="hidden w-[168px] items-center gap-2 overflow-hidden transition-[width] duration-200 ease-out lg:flex">
            <Link
              href="/"
              aria-label="Ir al inicio"
              className="inline-flex items-center"
            >
              <PiqueLogo
                variant={isSidebarCollapsed ? (isLight ? 'isotipo' : 'isotipoDark') : (isLight ? 'horizontal' : 'horizontalDark')}
                className={`transition-[opacity,transform,max-width,filter] duration-200 ease-out ${
                  isSidebarCollapsed ? 'h-8 w-8' : 'h-9 w-auto'
                }`}
              />
            </Link>
          </div>

          <div className="flex items-center gap-2 lg:hidden">
            <Link
              href="/"
              aria-label="Ir al inicio"
              className="inline-flex items-center"
            >
              <PiqueLogo variant={isLight ? 'horizontal' : 'horizontalDark'} className="h-9 w-auto" />
            </Link>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="h-9 rounded-lg px-3 text-sm font-semibold text-p-accent hover:bg-p-surface-2"
            >
              Ayuda
            </button>

            <div ref={clubMenuRef} className="relative">
              <button
                type="button"
                onClick={() => {
                  setProfileMenuOpen(false);
                  setClubMenuOpen((previous) => !previous);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setClubMenuOpen(true);
                  }
                }}
                aria-haspopup="menu"
                aria-expanded={clubMenuOpen}
                className={`inline-flex h-9 min-w-[180px] items-center justify-between gap-2 rounded-lg border bg-p-surface px-3 text-sm font-semibold shadow-sm transition outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-lima-300/40 focus-visible:ring-offset-0 ${
                  clubMenuOpen
                    ? 'border-p-border-strong text-p-text ring-2 ring-lima-300/25'
                    : 'border-p-border text-p-text-secondary hover:border-p-border-strong'
                }`}
              >
                <span className="truncate">{selectedClubLabel}</span>
                <ChevronDown
                  size={14}
                  className={`text-p-text-muted transition-transform ${clubMenuOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {clubMenuOpen && (
                <div className="absolute right-0 mt-2 w-[240px] rounded-xl border border-p-border bg-p-surface p-1 shadow-p-lg" style={{ zIndex: ADMIN_Z_INDEX.dropdown }}>
                  {clubOptions.length === 0 ? (
                    <div className="px-3 py-2 text-[13px] text-p-text-muted">Sin clubes disponibles</div>
                  ) : (
                    clubOptions.map((club) => {
                      const active = club.id === selectedClubId;
                      return (
                        <button
                          key={club.id}
                          type="button"
                          onClick={() => handleChangeActiveClub(club.id)}
                          className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] transition ${
                            active
                              ? 'bg-p-brand font-semibold text-p-brand-on'
                              : 'text-p-text-secondary hover:bg-p-surface-2'
                          }`}
                        >
                          <span className="truncate">{club.label}</span>
                          {active && <span className="text-[11px] font-bold">Activo</span>}
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            <div ref={profileMenuRef} className="relative">
              <button
                type="button"
                onClick={() => {
                  setClubMenuOpen(false);
                  setProfileMenuOpen((previous) => !previous);
                }}
                aria-haspopup="menu"
                aria-expanded={profileMenuOpen}
                className={`grid h-9 w-9 place-items-center rounded-full border text-sm font-bold transition ${
                  isLight
                    ? profileMenuOpen
                      ? 'border-p-border-strong bg-p-surface text-p-text ring-2 ring-lima-300/25'
                      : 'border-p-border bg-p-surface text-p-text-secondary hover:border-p-border-strong'
                    : profileMenuOpen
                      ? 'border-p-border-strong bg-p-brand text-p-brand-on ring-2 ring-lima-300/25'
                      : 'border-p-border bg-p-brand text-p-brand-on hover:brightness-95'
                }`}
                title="Cuenta"
                aria-label="Abrir menú de cuenta"
              >
                {userInitial}
              </button>
              {profileMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 mt-2 w-[220px] rounded-xl border border-p-border bg-p-surface p-1 shadow-p-lg"
                  style={{ zIndex: ADMIN_Z_INDEX.dropdown }}
                >
                  {hasOperatorPrivileges && (
                    <button
                      type="button"
                      onClick={() => {
                        setProfileMenuOpen(false);
                        void router.push('/admin/agenda');
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-p-text-secondary transition hover:bg-p-surface-2"
                    >
                      <ShieldCheck size={14} />
                      Gestión
                    </button>
                  )}
                  {hasOperatorPrivileges && adminClubSlug && (
                    <button
                      type="button"
                      onClick={() => {
                        setProfileMenuOpen(false);
                        void router.push(`/club/${adminClubSlug}`);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-p-text-secondary transition hover:bg-p-surface-2"
                    >
                      <MapPin size={14} />
                      Mi club
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      void router.push('/perfil');
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-p-text-secondary transition hover:bg-p-surface-2"
                  >
                    <Users size={14} />
                    Mi perfil
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      void router.push('/bookings');
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-p-text-secondary transition hover:bg-p-surface-2"
                  >
                    <Calendar size={14} />
                    Mis reservas
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      void router.push('/admin/ajustes');
                    }}
                    className="block w-full rounded-lg px-3 py-2 text-left text-[13px] text-p-text-secondary transition hover:bg-p-surface-2"
                  >
                    Configuración
                  </button>
                  <div className="my-1 h-px bg-p-border" />
                  <button
                    type="button"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      setLogoutConfirmOpen(true);
                    }}
                    className="block w-full rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-p-error transition hover:bg-p-error-bg"
                  >
                    Cerrar sesión
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 bg-p-surface">
          <aside
            className={`relative hidden h-full ${sidebarWidthClass} flex-col items-center overflow-visible bg-p-surface py-4 transition-[width,opacity] duration-200 ease-out will-change-[width] opacity-100 lg:flex`}
            style={{ zIndex: ADMIN_Z_INDEX.shellSidebar }}
          >
            <button
              type="button"
              onClick={() => setIsSidebarCollapsed((previous) => !previous)}
              className="absolute -right-3 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full border border-p-border bg-p-surface text-p-text-muted shadow-sm transition-transform duration-200 hover:bg-p-surface-2"
              style={{ zIndex: ADMIN_Z_INDEX.shellSidebar + 1 }}
              title={isSidebarCollapsed ? 'Expandir panel lateral' : 'Colapsar panel lateral'}
              aria-label={isSidebarCollapsed ? 'Expandir panel lateral' : 'Colapsar panel lateral'}
            >
              {isSidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
            </button>

            <nav className="w-full space-y-1 px-2">
              {visibleSidebarItems.map(({ label, icon: Icon, href, disabled }) => {
                const active = !disabled && label === activeItem;
                return (
                  <button
                    key={label}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      if (!disabled && router.pathname !== href) void router.push(href);
                    }}
                    className={`w-full rounded-md py-2 text-left text-[11px] transition-colors px-0 ${
                      disabled
                        ? 'cursor-not-allowed opacity-40 text-p-text-muted'
                        : active
                          ? 'bg-p-brand text-p-brand-on'
                          : 'text-p-text-muted hover:bg-p-surface-2'
                    }`}
                    title={disabled ? 'Disponible más adelante' : label}
                    aria-disabled={disabled}
                  >
                    <span className="grid grid-cols-[48px_1fr] items-center">
                      <span className="inline-flex w-full shrink-0 justify-center">
                        <Icon size={14} />
                      </span>
                      <span
                        className={`truncate whitespace-nowrap transition-[opacity,transform,max-width,filter] duration-200 ease-out ${
                          isSidebarCollapsed
                            ? 'max-w-0 -translate-x-1 opacity-0 blur-[1px]'
                            : 'max-w-[124px] translate-x-0 opacity-100 blur-0'
                        }`}
                      >
                        {label}
                      </span>
                    </span>
                  </button>
                );
              })}
            </nav>
          </aside>

          <main
            className={`relative flex-1 h-full min-w-0 rounded-tl-[12px] overflow-hidden bg-p-bg transition ${
              contentMuted ? 'pointer-events-none select-none opacity-80' : 'opacity-100'
            }`}
          >
            {children}
          </main>
        </div>
        <nav className="flex h-[62px] shrink-0 items-center gap-1 overflow-x-auto border-t border-p-border bg-p-surface px-2 lg:hidden">
          {visibleSidebarItems.map(({ label, icon: Icon, href, disabled }) => {
            const active = !disabled && label === activeItem;
            return (
              <button
                key={`mobile-${label}`}
                type="button"
                disabled={disabled}
                onClick={() => {
                  if (!disabled && router.pathname !== href) void router.push(href);
                }}
                className={`flex h-12 min-w-[76px] flex-col items-center justify-center rounded-xl px-2 text-[10px] font-semibold transition ${
                  disabled
                    ? 'cursor-not-allowed opacity-40 text-p-text-muted'
                    : active
                      ? 'bg-p-brand text-p-brand-on'
                      : 'text-p-text-muted hover:bg-p-surface-2'
                }`}
                title={disabled ? 'Disponible más adelante' : label}
                aria-label={disabled ? `${label} — Disponible más adelante` : label}
                aria-disabled={disabled}
              >
                <Icon size={15} />
                <span className="mt-1 max-w-[68px] truncate">{label}</span>
              </button>
            );
          })}
        </nav>
      </div>
      {helpOpen && (
        <div
          className="fixed inset-0 bg-ink-900/55 backdrop-blur-[1px] flex items-center justify-center p-4"
          style={{ zIndex: ADMIN_Z_INDEX.modal }}
          onClick={() => setHelpOpen(false)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Centro de ayuda"
            className="w-full max-w-[680px] rounded-2xl border border-p-border bg-p-surface shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-p-border px-5 py-4">
              <div>
                <h2 className="text-[21px] font-bold tracking-[-0.01em] text-p-text">Centro de ayuda</h2>
                <p className="mt-1 text-[12px] text-p-text-muted">Sección actual: {activeItem}</p>
              </div>
              <button
                type="button"
                onClick={() => setHelpOpen(false)}
                className="grid h-8 w-8 place-items-center rounded-full border border-p-border text-p-text-muted hover:bg-p-surface-2"
                aria-label="Cerrar ayuda"
              >
                <X size={14} />
              </button>
            </div>
            <div className="space-y-4 px-5 py-5">
              <section className="rounded-xl border border-p-border bg-p-surface-2 px-4 py-3">
                <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-p-accent">
                  Qué podés hacer acá
                </p>
                <ul className="mt-2 space-y-2 text-[14px] text-p-text-secondary">
                  {sectionHelpTips.map((tip) => (
                    <li key={tip} className="flex items-start gap-2">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-p-accent" />
                      <span>{tip}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="rounded-xl border border-p-border bg-p-surface px-4 py-3">
                <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-p-text-muted">
                  Problemas frecuentes
                </p>
                <ul className="mt-2 space-y-2 text-[13px] text-p-text-secondary">
                  <li>Si no te deja continuar, revisá fecha, cancha y horario antes de cobros o participantes.</li>
                  <li>Si no ves una reserva, verificá filtros activos y club seleccionado.</li>
                  <li>Ante inconsistencias, recargá la pantalla y reintentá la operación.</li>
                </ul>
              </section>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-p-border px-5 py-4">
              <a
                href={HELP_EMAIL_URL}
                className="h-10 rounded-xl border border-p-border bg-p-surface px-4 text-sm font-semibold text-p-text-secondary inline-flex items-center"
              >
                Enviar email
              </a>
              <a
                href={HELP_WHATSAPP_URL}
                target="_blank"
                rel="noreferrer"
                className="h-10 rounded-xl bg-p-brand px-4 text-sm font-bold text-p-brand-on inline-flex items-center hover:bg-lima-200"
              >
                Contactar por WhatsApp
              </a>
            </div>
          </div>
        </div>
      )}
      {logoutConfirmOpen && (
        <div
          className="fixed inset-0 bg-ink-900/55 backdrop-blur-[1px] flex items-center justify-center p-4"
          style={{ zIndex: ADMIN_Z_INDEX.modal }}
          onClick={() => setLogoutConfirmOpen(false)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Confirmar cierre de sesión"
            className="w-full max-w-[420px] rounded-2xl border border-p-border bg-p-surface shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-p-border px-5 py-4">
              <h2 className="text-[19px] font-bold tracking-[-0.01em] text-p-text">Cerrar sesión</h2>
              <button
                type="button"
                onClick={() => setLogoutConfirmOpen(false)}
                className="grid h-8 w-8 place-items-center rounded-full border border-p-border text-p-text-muted hover:bg-p-surface-2"
                aria-label="Cerrar confirmación de cierre de sesión"
              >
                <X size={14} />
              </button>
            </div>
            <div className="px-5 py-5">
              <p className="text-[14px] text-p-text-secondary">
                ¿Querés cerrar sesión ahora? Vas a volver a la pantalla de login.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-p-border px-5 py-4">
              <button
                type="button"
                onClick={() => setLogoutConfirmOpen(false)}
                className="h-10 rounded-xl border border-p-border bg-p-surface px-4 text-sm font-semibold text-p-text-secondary hover:bg-p-surface-2"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => logout({ redirectTo: '/login' })}
                className="h-10 rounded-xl bg-p-error px-4 text-sm font-bold text-ink-50 hover:opacity-90"
              >
                Sí, cerrar sesión
              </button>
            </div>
          </div>
        </div>
      )}
      <AdminToast />
    </div>
  );
}
