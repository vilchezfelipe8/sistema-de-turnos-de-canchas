import { Request } from 'express';
import { MembershipRole } from '@prisma/client';
import { getUserClubContext } from './getUserClubContext';

export type ResolvedClubContext = {
  clubId: number;
  role: MembershipRole;
};

const parseNumericClubId = (value: unknown): number | undefined => {
  if (value == null) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
  return parsed;
};

export const getPreferredClubIdFromRequest = (req: Request): number | undefined => {
  const headerActive = req.headers['x-active-club-id'];
  const headerClub = req.headers['x-club-id'];
  const queryClub = (req.query as any)?.clubId;
  const queryActiveClub = (req.query as any)?.activeClubId;

  if (headerClub != null || queryClub != null || queryActiveClub != null) {
    throw new Error('Contexto de club inválido: use solo el header x-active-club-id');
  }

  const rawValue =
    (Array.isArray(headerActive) ? headerActive[0] : headerActive);

  return parseNumericClubId(rawValue);
};

export const resolveClubContextFromRequest = async (
  req: Request,
  userId: number
): Promise<ResolvedClubContext> => {
  const preferredClubId = getPreferredClubIdFromRequest(req);
  return getUserClubContext(userId, preferredClubId);
};
