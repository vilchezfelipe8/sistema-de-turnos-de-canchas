import { useState } from 'react';
import AdminRouteShell from '../../components/admin/AdminRouteShell';
import ClubMessagesPanel from '../../components/admin/messages/ClubMessagesPanel';
import ClubMessagesHistory from '../../components/admin/messages/ClubMessagesHistory';
import WhatsappOpsPanel from '../../components/admin/messages/WhatsappOpsPanel';
import { AdminPage } from '../../components/admin/ui';

type MessagesTab = 'club' | 'tecnico';

// Mensajes: qué avisos por WhatsApp salen solos en el club.
// El panel técnico (remitentes, plantillas, webhooks) es solo para el equipo de Pique.
export default function AdminMessagesPage() {
  return (
    <AdminRouteShell title="Mensajes | Pique Admin" activeItem="Mensajes" fromPath="/admin/mensajes">
      {(user) => <MessagesContent isPiqueTeam={user?.isPiqueTeam === true} />}
    </AdminRouteShell>
  );
}

function MessagesContent({ isPiqueTeam }: { isPiqueTeam: boolean }) {
  const [tab, setTab] = useState<MessagesTab>('club');

  return (
    <AdminPage
      title="Mensajes"
      description="Los avisos por WhatsApp que salen solos cuando pasa algo con una reserva."
      tabs={
        // Solo equipo de Pique (no alcanza con ser dueño de club). El backend lo exige igual.
        isPiqueTeam
          ? {
              options: [
                { value: 'club', label: 'Avisos' },
                { value: 'tecnico', label: 'Técnico (Pique)' },
              ],
              value: tab,
              onChange: (value) => setTab(value as MessagesTab),
              ariaLabel: 'Secciones de mensajes',
            }
          : undefined
      }
    >
      <div className="flex flex-col gap-4">
        {tab === 'tecnico' && isPiqueTeam ? (
          <WhatsappOpsPanel />
        ) : (
          <>
            <ClubMessagesPanel />
            <ClubMessagesHistory />
          </>
        )}
      </div>
    </AdminPage>
  );
}
