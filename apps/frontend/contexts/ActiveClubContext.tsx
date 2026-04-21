import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { getEffectiveActiveClubId, getStoredUser, setActiveClubId } from '../utils/session';

type ActiveClubContextValue = {
  activeClubId: number | null;
  setActiveClub: (clubId: number) => void;
  refreshActiveClub: () => void;
};

const ActiveClubContext = createContext<ActiveClubContextValue | undefined>(undefined);

export const ActiveClubProvider = ({ children }: { children: ReactNode }) => {
  const [activeClubId, setActiveClubIdState] = useState<number | null>(null);

  const refreshActiveClub = useCallback(() => {
    const user = getStoredUser();
    setActiveClubIdState(getEffectiveActiveClubId(user));
  }, []);

  useEffect(() => {
    refreshActiveClub();

    const onStorage = (event: StorageEvent) => {
      if (event.key === 'user' || event.key === 'activeClubId') {
        refreshActiveClub();
      }
    };

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [refreshActiveClub]);

  const setActiveClub = useCallback((clubId: number) => {
    const updatedUser = setActiveClubId(clubId);
    setActiveClubIdState(getEffectiveActiveClubId(updatedUser));
  }, []);

  const value = useMemo(() => ({ activeClubId, setActiveClub, refreshActiveClub }), [activeClubId, setActiveClub, refreshActiveClub]);

  return <ActiveClubContext.Provider value={value}>{children}</ActiveClubContext.Provider>;
};

export const useActiveClub = () => {
  const context = useContext(ActiveClubContext);
  if (!context) {
    throw new Error('useActiveClub debe usarse dentro de ActiveClubProvider');
  }
  return context;
};
