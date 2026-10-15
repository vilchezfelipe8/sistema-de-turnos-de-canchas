import type { Club } from '../services/ClubService';

export const PUBLIC_SPORT_OPTIONS = [
  { value: '', label: 'Todos los deportes' },
  { value: 'football', label: 'Fútbol' },
  { value: 'padel', label: 'Pádel' },
  { value: 'tennis', label: 'Tenis' },
  { value: 'basketball', label: 'Básquet' },
  { value: 'volleyball', label: 'Vóley' },
] as const;

export type PublicSport = typeof PUBLIC_SPORT_OPTIONS[number]['value'];

export const PUBLIC_SPORT_LABELS: Record<PublicSport, string> = Object.fromEntries(
  PUBLIC_SPORT_OPTIONS.map(({ value, label }) => [value, label]),
) as Record<PublicSport, string>;

export const normalizeFilterText = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim();

const SPORT_ALIASES: Record<string, PublicSport> = {
  football: 'football', futbol: 'football', soccer: 'football',
  padel: 'padel',
  tennis: 'tennis', tenis: 'tennis',
  basketball: 'basketball', basquet: 'basketball', basket: 'basketball',
  volleyball: 'volleyball', voley: 'volleyball', voleibol: 'volleyball',
};

export const normalizePublicSport = (value: string): PublicSport => {
  const key = normalizeFilterText(value);
  return Object.prototype.hasOwnProperty.call(SPORT_ALIASES, key) ? SPORT_ALIASES[key] : '';
};

export const getPublicClubLocations = (clubs: Club[]) => {
  const locations = new Map<string, {
    label: string; query: string; city: string; province: string; country: string;
  }>();
  for (const club of clubs) {
    const city = club.city?.trim();
    if (!city || locations.has(city)) continue;
    const province = club.province?.trim() || '';
    const country = club.country?.trim() || '';
    locations.set(city, {
      city, province, country,
      label: [city, province].filter(Boolean).join(', '),
      query: [city, province, country].filter(Boolean).join(', '),
    });
  }
  return [...locations.values()].sort((a, b) => a.city.localeCompare(b.city, 'es'));
};

export const matchesPublicClubFilters = (
  club: Club,
  { search = '', zone = '', sport = '' }: { search?: string; zone?: string; sport?: string },
): boolean => {
  const query = normalizeFilterText(search);
  if (query && !normalizeFilterText(
    `${club.name} ${club.city} ${club.province} ${club.addressLine} ${club.description || ''}`,
  ).includes(query)) return false;
  if (zone && normalizeFilterText(club.city) !== normalizeFilterText(zone)) return false;
  const normalizedSport = normalizePublicSport(sport);
  return !normalizedSport || Boolean(club.publicSports?.includes(normalizedSport));
};
