/**
 * Equipo de Pique (operadores de la plataforma), separado de los dueños de club.
 *
 * Los dueños de club también tienen rol global ADMIN (lo crean así los scripts de alta),
 * así que el rol solo NO alcanza para abrir herramientas de plataforma (WhatsApp de todos
 * los clubes, crear clubes). Además hay que estar en PIQUE_TEAM_EMAILS (separados por coma).
 * Vacía = nadie: seguro por defecto.
 */
export const getPiqueTeamEmails = (): Set<string> =>
  new Set(
    String(process.env.PIQUE_TEAM_EMAILS || '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );

export const isPiqueTeamUser = (user: { role?: string | null; email?: string | null } | null | undefined): boolean => {
  if (!user || String(user.role || '') !== 'ADMIN') return false;
  const email = String(user.email || '').trim().toLowerCase();
  return Boolean(email) && getPiqueTeamEmails().has(email);
};
