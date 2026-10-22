import type { NextApiRequest, NextApiResponse } from 'next';
import { CLUB_APP_QUERY_VALUE, clubIconHref, isValidClubSlug } from '../../../utils/clubApp';

// Manifest de la "app del club": el acceso directo abre la página del club (no el home de Pique)
// y cada club se instala como una app aparte (id propio), con su nombre e ícono.
const cleanName = (value: unknown) =>
  String(Array.isArray(value) ? value[0] : value || '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, 60);

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const slug = Array.isArray(req.query.slug) ? req.query.slug[0] : req.query.slug;
  if (!isValidClubSlug(slug)) {
    res.status(400).json({ error: 'Club inválido' });
    return;
  }
  const name = cleanName(req.query.name) || 'Pique';
  const shortName = name.length > 14 ? name.replace(/^(club\s+)?(atl[eé]tico\s+)?/i, '').slice(0, 14).trim() : name;

  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).json({
    id: `/club/${slug}`,
    name,
    short_name: shortName || name,
    description: `Reservá tus turnos en ${name}.`,
    start_url: `/club/${slug}?app=${CLUB_APP_QUERY_VALUE}`,
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0B0E12',
    theme_color: '#0B0E12',
    lang: 'es-AR',
    icons: [
      { src: clubIconHref(slug, name, 192), sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: clubIconHref(slug, name, 512), sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `${clubIconHref(slug, name, 512)}&maskable=1`, sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  });
}
