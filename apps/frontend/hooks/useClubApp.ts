import { useEffect, useState } from 'react';
import { CLUB_APP_CHANGED_EVENT, readClubApp, type ClubAppIdentity } from '../utils/clubApp';

// Club de la app instalada (null = navegador o app general de Pique).
export function useClubApp(): ClubAppIdentity | null {
  const [clubApp, setClubApp] = useState<ClubAppIdentity | null>(null);
  useEffect(() => {
    const sync = () => setClubApp(readClubApp());
    sync();
    window.addEventListener(CLUB_APP_CHANGED_EVENT, sync);
    return () => window.removeEventListener(CLUB_APP_CHANGED_EVENT, sync);
  }, []);
  return clubApp;
}
