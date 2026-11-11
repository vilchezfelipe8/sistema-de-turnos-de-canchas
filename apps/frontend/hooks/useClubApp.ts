import { useEffect, useState } from 'react';
import { CLUB_APP_CHANGED_EVENT, getCachedClubApp, readClubApp, type ClubAppIdentity } from '../utils/clubApp';

// Club de la app instalada (null = navegador o app general de Pique).
// Arranca con lo último que se leyó para que al cambiar de pantalla no se vea un instante la versión web;
// en la primera carga arranca en null (igual que el servidor) y se actualiza al montar.
export function useClubApp(): ClubAppIdentity | null {
  const [clubApp, setClubApp] = useState<ClubAppIdentity | null>(() => getCachedClubApp());
  useEffect(() => {
    const sync = () => {
      const next = readClubApp();
      setClubApp((prev) => (
        prev?.slug === next?.slug && prev?.name === next?.name && prev?.logoUrl === next?.logoUrl ? prev : next
      ));
    };
    sync();
    window.addEventListener(CLUB_APP_CHANGED_EVENT, sync);
    return () => window.removeEventListener(CLUB_APP_CHANGED_EVENT, sync);
  }, []);
  return clubApp;
}
