import { useAuth, type AuthUser } from '../contexts/AuthContext';

export interface UseValidateAuthOptions {
  requireAdmin?: boolean;
  allowGuest?: boolean;
}

export function useValidateAuth(_options: UseValidateAuthOptions = {}): { authChecked: boolean; user: AuthUser | null } {
  const { status, user } = useAuth();

  return { authChecked: status !== 'unknown', user };
}
