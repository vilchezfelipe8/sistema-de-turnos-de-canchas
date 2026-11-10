import { useEffect, useState } from 'react';
import AdminRouteShell from '../../components/admin/AdminRouteShell';
import ClubMessagesPanel from '../../components/admin/messages/ClubMessagesPanel';
import ClubMessagesHistory from '../../components/admin/messages/ClubMessagesHistory';
import WhatsappOpsPanel from '../../components/admin/messages/WhatsappOpsPanel';
import { getStoredUser } from '../../utils/session';

type MessagesTab = 'club' | 'tecnico';

// Mensajes: qué avisos por WhatsApp salen solos en el club.
// El panel técnico (remitentes, plantillas, webhooks) es solo para el equipo de Pique.
export default function AdminMessagesPage() {
  const [isPiqueTeam, setIsPiqueTeam] = useState(false);
  const [tab, setTab] = useState<MessagesTab>('club');

  useEffect(() => {
    // Admin global de Pique: puede ver el panel técnico (el backend lo exige igual).
    setIsPiqueTeam(String(getStoredUser()?.role || '').toUpperCase() === 'ADMIN');
  }, []);

  return (
    <AdminRouteShell title="Mensajes | Pique Admin" activeItem="Mensajes" fromPath="/admin/mensajes">
      <section className="h-full min-h-0 overflow-y-auto p-4 pb-20 lg:p-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          <div>
            <h1 className="text-[22px] font-bold text-p-text">Mensajes</h1>
            <p className="text-[13px] text-p-text-muted">Los avisos por WhatsApp que salen solos cuando pasa algo con una reserva.</p>
          </div>

          {isPiqueTeam && (
            <div className="flex w-fit gap-1 rounded-xl border border-p-border bg-p-surface p-1">
              {([
                { id: 'club', label: 'Avisos' },
                { id: 'tecnico', label: 'Técnico (Pique)' },
              ] as Array<{ id: MessagesTab; label: string }>).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={tab === option.id}
                  onClick={() => setTab(option.id)}
                  className={`h-8 rounded-lg px-3 text-[13px] font-semibold ${
                    tab === option.id ? 'bg-ink-900 text-ink-50' : 'text-p-text-secondary hover:bg-p-surface-2'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}

          {tab === 'tecnico' && isPiqueTeam ? (
            <WhatsappOpsPanel />
          ) : (
            <>
              <ClubMessagesPanel />
              <ClubMessagesHistory />
            </>
          )}
        </div>
      </section>
    </AdminRouteShell>
  );
}
