import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/router';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react';
import { logout } from '../../services/AuthService';
import { normalizeSessionUser, setActiveClubId } from '../../utils/session';
import { PLAYGROUND_SIDEBAR_ITEMS } from './playgroundNavigation';

type AdminPlaygroundShellProps = {
  activeItem: string;
  children: ReactNode;
  contentMuted?: boolean;
  user: any;
};

const HELP_WHATSAPP_URL = 'https://wa.me/5493513436163';
const HELP_EMAIL_URL = 'mailto:soporte.tucancha@gmail.com';

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
  Pagos: [
    'Registrá pagos parciales cuando no se abone el total.',
    'Verificá el responsable de cobro antes de confirmar.',
    'Usá la trazabilidad para auditar ajustes y movimientos.',
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
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [clubMenuOpen, setClubMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [selectedClubId, setSelectedClubId] = useState<number>(0);
  const clubMenuRef = useRef<HTMLDivElement | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);

  const normalizedUser = useMemo(() => normalizeSessionUser(user || null), [user]);
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
    document.documentElement.style.setProperty('--admin-playground-sidebar-left', nextLeft);
    return () => {
      document.documentElement.style.removeProperty('--admin-playground-sidebar-left');
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
    <div className="h-screen w-full overflow-hidden bg-[#f5f6f8] text-[#1a1a1a]">
      <div className="flex h-full w-full flex-col">
        <header className="flex h-16 items-center bg-white px-4 lg:px-6">
          <div className="hidden w-[168px] items-center gap-2 overflow-hidden transition-[width] duration-200 ease-out lg:flex">
            <div className="grid h-8 w-8 place-items-center rounded-lg border border-[#d9dfeb] bg-[#f5f7ff] text-[11px] font-black text-[#2a2f5b]">
              TC
            </div>
            <span
              className={`whitespace-nowrap text-[12px] font-black tracking-[0.22em] text-[#2a2f5b] transition-[opacity,transform,max-width,filter] duration-200 ease-out ${
                isSidebarCollapsed
                  ? 'max-w-0 -translate-x-1 opacity-0 blur-[1px]'
                  : 'max-w-[118px] translate-x-0 opacity-100 blur-0'
              }`}
            >
              TUCANCHA
            </span>
          </div>

          <div className="flex items-center gap-2 lg:hidden">
            <div className="grid h-8 w-8 place-items-center rounded-lg border border-[#d9dfeb] bg-[#f5f7ff] text-[11px] font-black text-[#2a2f5b]">
              TC
            </div>
            <span className="text-[12px] font-black tracking-[0.22em] text-[#2a2f5b]">TUCANCHA</span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="h-9 rounded-lg px-3 text-sm font-semibold text-[#4a5eaa] hover:bg-[#f3f6ff]"
            >
              Ayuda
            </button>

            <div ref={clubMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setClubMenuOpen((previous) => !previous)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setClubMenuOpen(true);
                  }
                }}
                aria-haspopup="menu"
                aria-expanded={clubMenuOpen}
                className={`inline-flex h-9 min-w-[180px] items-center justify-between gap-2 rounded-lg border bg-white px-3 text-sm font-semibold shadow-sm transition outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[#dce6ff] focus-visible:ring-offset-0 ${
                  clubMenuOpen
                    ? 'border-[#bfc8da] text-[#1f2a44] ring-2 ring-[#ebf0ff]'
                    : 'border-[#dfe4ee] text-[#2a3348] hover:border-[#cfd7e6]'
                }`}
              >
                <span className="truncate">{selectedClubLabel}</span>
                <ChevronDown
                  size={14}
                  className={`text-[#7a8398] transition-transform ${clubMenuOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {clubMenuOpen && (
                <div className="absolute right-0 z-40 mt-2 w-[240px] rounded-xl border border-[#dbe2ef] bg-white p-1 shadow-xl">
                  {clubOptions.length === 0 ? (
                    <div className="px-3 py-2 text-[13px] text-[#7a8398]">Sin clubes disponibles</div>
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
                              ? 'bg-[#edf1ff] font-semibold text-[#2748cc]'
                              : 'text-[#3a435b] hover:bg-[#f5f7fb]'
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
                onClick={() => setProfileMenuOpen((previous) => !previous)}
                aria-haspopup="menu"
                aria-expanded={profileMenuOpen}
                className={`grid h-9 w-9 place-items-center rounded-full border bg-white text-sm font-bold transition ${
                  profileMenuOpen
                    ? 'border-[#bac8e5] text-[#1f2a44] ring-2 ring-[#ebf0ff]'
                    : 'border-[#e5e7eb] text-[#2a3348] hover:border-[#cfd7e6]'
                }`}
                title="Cuenta"
                aria-label="Abrir menú de cuenta"
              >
                {userInitial}
              </button>
              {profileMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 z-40 mt-2 w-[220px] rounded-xl border border-[#dbe2ef] bg-white p-1 shadow-xl"
                >
                  <button
                    type="button"
                    className="block w-full cursor-default rounded-lg px-3 py-2 text-left text-[13px] text-[#8a93a7]"
                  >
                    Mi perfil (próximamente)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      void router.push('/admin/ajustes');
                    }}
                    className="block w-full rounded-lg px-3 py-2 text-left text-[13px] text-[#3a435b] transition hover:bg-[#f5f7fb]"
                  >
                    Configuración
                  </button>
                  <div className="my-1 h-px bg-[#eef1f6]" />
                  <button
                    type="button"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      setLogoutConfirmOpen(true);
                    }}
                    className="block w-full rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-[#b42346] transition hover:bg-[#fff5f8]"
                  >
                    Cerrar sesión
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 bg-white">
          <aside
            className={`relative z-[120] hidden h-full ${sidebarWidthClass} flex-col items-center overflow-visible bg-white py-4 transition-[width,opacity] duration-200 ease-out will-change-[width] opacity-100 lg:flex`}
          >
            <button
              type="button"
              onClick={() => setIsSidebarCollapsed((previous) => !previous)}
              className="absolute -right-3 top-1/2 z-[130] grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full border border-[#dfe4ec] bg-white text-[#6f7890] shadow-sm transition-transform duration-200 hover:bg-[#f7f9fc]"
              title={isSidebarCollapsed ? 'Expandir panel lateral' : 'Colapsar panel lateral'}
              aria-label={isSidebarCollapsed ? 'Expandir panel lateral' : 'Colapsar panel lateral'}
            >
              {isSidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
            </button>

            <nav className="w-full space-y-1 px-2">
              {PLAYGROUND_SIDEBAR_ITEMS.map(({ label, icon: Icon, href }) => {
                const active = label === activeItem;
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => {
                      if (href && router.pathname !== href) void router.push(href);
                    }}
                    className={`w-full rounded-md py-2 text-left text-[11px] transition-colors ${
                      active ? 'bg-[#eef1ff] text-[#2b3fa8]' : 'text-[#8b92a0] hover:bg-[#f4f5f7]'
                    } px-0`}
                    title={label}
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
            className={`relative flex-1 h-full min-w-0 rounded-tl-[12px] overflow-hidden bg-[#f5f6f8] transition ${
              contentMuted ? 'pointer-events-none select-none opacity-80' : 'opacity-100'
            }`}
          >
            {children}
          </main>
        </div>
      </div>
      {helpOpen && (
        <div
          className="fixed inset-0 z-[2147483200] bg-[#0f172a]/40 backdrop-blur-[1px] flex items-center justify-center p-4"
          onClick={() => setHelpOpen(false)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Centro de ayuda"
            className="w-full max-w-[680px] rounded-2xl border border-[#dbe2ef] bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#eef1f6] px-5 py-4">
              <div>
                <h2 className="text-[21px] font-bold tracking-[-0.01em] text-[#1f2a44]">Centro de ayuda</h2>
                <p className="mt-1 text-[12px] text-[#6f7890]">Sección actual: {activeItem}</p>
              </div>
              <button
                type="button"
                onClick={() => setHelpOpen(false)}
                className="grid h-8 w-8 place-items-center rounded-full border border-[#dce3ef] text-[#76819b] hover:bg-[#f6f8fc]"
                aria-label="Cerrar ayuda"
              >
                <X size={14} />
              </button>
            </div>
            <div className="space-y-4 px-5 py-5">
              <section className="rounded-xl border border-[#e7ebf4] bg-[#f8faff] px-4 py-3">
                <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#5670d1]">
                  Qué podés hacer acá
                </p>
                <ul className="mt-2 space-y-2 text-[14px] text-[#2e3b57]">
                  {sectionHelpTips.map((tip) => (
                    <li key={tip} className="flex items-start gap-2">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#5670d1]" />
                      <span>{tip}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="rounded-xl border border-[#eceff5] bg-white px-4 py-3">
                <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#5f6b85]">
                  Problemas frecuentes
                </p>
                <ul className="mt-2 space-y-2 text-[13px] text-[#42506d]">
                  <li>Si no te deja continuar, revisá fecha, cancha y horario antes de cobros o participantes.</li>
                  <li>Si no ves una reserva, verificá filtros activos y club seleccionado.</li>
                  <li>Ante inconsistencias, recargá la pantalla y reintentá la operación.</li>
                </ul>
              </section>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#eef1f6] px-5 py-4">
              <a
                href={HELP_EMAIL_URL}
                className="h-10 rounded-xl border border-[#dbe2ef] bg-white px-4 text-sm font-semibold text-[#4e5870] inline-flex items-center"
              >
                Enviar email
              </a>
              <a
                href={HELP_WHATSAPP_URL}
                target="_blank"
                rel="noreferrer"
                className="h-10 rounded-xl bg-[#3053e2] px-4 text-sm font-bold text-white inline-flex items-center hover:bg-[#2748cc]"
              >
                Contactar por WhatsApp
              </a>
            </div>
          </div>
        </div>
      )}
      {logoutConfirmOpen && (
        <div
          className="fixed inset-0 z-[2147483200] bg-[#0f172a]/40 backdrop-blur-[1px] flex items-center justify-center p-4"
          onClick={() => setLogoutConfirmOpen(false)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Confirmar cierre de sesión"
            className="w-full max-w-[420px] rounded-2xl border border-[#e3e7f0] bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#eef1f6] px-5 py-4">
              <h2 className="text-[19px] font-bold tracking-[-0.01em] text-[#1f2a44]">Cerrar sesión</h2>
              <button
                type="button"
                onClick={() => setLogoutConfirmOpen(false)}
                className="grid h-8 w-8 place-items-center rounded-full border border-[#dce3ef] text-[#76819b] hover:bg-[#f6f8fc]"
                aria-label="Cerrar confirmación de cierre de sesión"
              >
                <X size={14} />
              </button>
            </div>
            <div className="px-5 py-5">
              <p className="text-[14px] text-[#44506b]">
                ¿Querés cerrar sesión ahora? Vas a volver a la pantalla de login.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-[#eef1f6] px-5 py-4">
              <button
                type="button"
                onClick={() => setLogoutConfirmOpen(false)}
                className="h-10 rounded-xl border border-[#dbe2ef] bg-white px-4 text-sm font-semibold text-[#4e5870] hover:bg-[#f7f9fc]"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => logout({ redirectTo: '/login' })}
                className="h-10 rounded-xl bg-[#cf3f57] px-4 text-sm font-bold text-white hover:bg-[#b8354b]"
              >
                Sí, cerrar sesión
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
