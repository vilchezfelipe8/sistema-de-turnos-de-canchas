import type { GetServerSideProps } from 'next';

/**
 * Fase 1.3 — Módulo disabled.
 * Redirige a Agenda hasta que el módulo esté listo para producción.
 * El ítem "Reservas" sigue visible en el sidebar pero no es clickeable.
 * Para rehabilitar: eliminar getServerSideProps y restaurar el componente de abajo.
 */
export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: { destination: '/admin/agenda', permanent: false },
});

export default function AdminBookingsPage() {
  return null;
}

/*
// Componente original — restaurar cuando el módulo esté listo:
import AdminRouteShell from '../../components/admin/AdminRouteShell';
import AdminComingSoonPanel from '../../components/admin/AdminComingSoonPanel';

export default function AdminBookingsPage() {
  return (
    <AdminRouteShell title="Reservas | Pique Admin" activeItem="Reservas" fromPath="/admin/reservas">
      <section className="h-full min-h-0 overflow-y-auto p-4 pb-20 lg:p-6">
        <AdminComingSoonPanel
          title="Reservas"
          description="Este modulo se mantiene visible para la hoja de ruta y va a consolidar la operacion de reservas fuera de Agenda."
        />
      </section>
    </AdminRouteShell>
  );
}
*/
