import UserLoadingState from './UserLoadingState';

interface RouteTransitionScreenProps {
  message?: string;
}

// Se mantiene por compatibilidad con el admin; usa la misma pantalla de carga que el resto de la app.
export default function RouteTransitionScreen({
  message = 'Redirigiendo...'
}: RouteTransitionScreenProps) {
  return <UserLoadingState mode="page" message={message} />;
}
