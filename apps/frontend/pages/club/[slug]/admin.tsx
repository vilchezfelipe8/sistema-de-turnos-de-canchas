import NotFound from '../../../components/NotFound';

/**
 * Ruta obsoleta: el panel está en /admin/agenda, /admin/canchas, etc.
 */
export default function ClubAdmin404() {
  return <NotFound message="Esta ruta ya no existe. Usá Inicio → Gestión para ir al panel." />;
}
