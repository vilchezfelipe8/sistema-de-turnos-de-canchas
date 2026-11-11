import { ImageResponse } from 'next/og';
import type { NextRequest } from 'next/server';
import { clubInitials, isValidClubSlug } from '../../../utils/clubApp';

export const config = { runtime: 'edge' };

const SIZES = new Set([180, 192, 512]);
// Formatos que el generador de imágenes sabe dibujar; otros (ej. webp) usan las iniciales.
const LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/svg+xml']);
const MAX_LOGO_BYTES = 3 * 1024 * 1024;

// Geist (la tipografía de la app) en peso 800, desde Google Fonts. Si no se puede bajar,
// el ícono sale igual con la fuente por defecto.
let geistFontPromise: Promise<ArrayBuffer | null> | null = null;
const loadGeistFont = () => {
  if (!geistFontPromise) {
    geistFontPromise = (async () => {
      try {
        const css = await fetch('https://fonts.googleapis.com/css2?family=Geist:wght@800').then((res) => res.text());
        const url = css.match(/src:\s*url\(([^)]+)\)\s*format\('(?:truetype|opentype)'\)/)?.[1];
        if (!url) return null;
        const res = await fetch(url);
        return res.ok ? await res.arrayBuffer() : null;
      } catch {
        return null;
      }
    })();
  }
  return geistFontPromise;
};

const toBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
};

// El logo se busca a partir del club (nunca de una dirección recibida en el pedido),
// así el generador no puede usarse para descargar imágenes de cualquier lado.
const loadClubLogo = async (origin: string, slug: string): Promise<{ name: string; logo: string | null } | null> => {
  try {
    const apiBase = (process.env.INTERNAL_API_URL || origin).replace(/\/+$/, '');
    const clubRes = await fetch(`${apiBase}/api/clubs/slug/${encodeURIComponent(slug)}`);
    if (!clubRes.ok) return null;
    const club = await clubRes.json();
    const name = String(club?.name || '');
    const rawLogo = String(club?.logoUrl || '').trim();
    if (!rawLogo) return { name, logo: null };
    if (rawLogo.startsWith('data:image/')) {
      const type = rawLogo.slice(5, rawLogo.indexOf(';'));
      return { name, logo: LOGO_TYPES.has(type) && rawLogo.length < MAX_LOGO_BYTES * 1.4 ? rawLogo : null };
    }
    const logoUrl = new URL(rawLogo, origin);
    if (logoUrl.protocol !== 'https:' && logoUrl.origin !== new URL(origin).origin) return { name, logo: null };
    const logoRes = await fetch(logoUrl.toString());
    const type = String(logoRes.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!logoRes.ok || !LOGO_TYPES.has(type)) return { name, logo: null };
    const buffer = await logoRes.arrayBuffer();
    if (buffer.byteLength > MAX_LOGO_BYTES) return { name, logo: null };
    return { name, logo: `data:${type};base64,${toBase64(buffer)}` };
  } catch {
    return null;
  }
};

// Ícono de la app del club. Con logo: el logo centrado sobre blanco. Sin logo: las iniciales del
// club con los colores de Pique (verde marca sobre verde profundo). La versión "maskable" deja más
// margen para que Android pueda recortarlo en círculo sin cortar nada.
export default async function handler(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const requestedSize = Number(searchParams.get('size'));
  const size = SIZES.has(requestedSize) ? requestedSize : 512;
  const maskable = searchParams.get('maskable') === '1';
  const slug = searchParams.get('slug');
  const club = isValidClubSlug(slug) ? await loadClubLogo(origin, slug) : null;
  const name = String(club?.name || searchParams.get('name') || '').slice(0, 60);
  const headers = { 'Cache-Control': 'public, max-age=86400' };

  if (club?.logo) {
    const logoBox = Math.round(size * (maskable ? 0.62 : 0.8));
    return new ImageResponse(
      (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#FFFFFF' }}>
          {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
          <img src={club.logo} width={logoBox} height={logoBox} style={{ objectFit: 'contain' }} />
        </div>
      ),
      { width: size, height: size, headers }
    );
  }

  const geist = await loadGeistFont();
  const initials = clubInitials(name).slice(0, 2) || 'P';
  const fontSize = Math.round(size * (maskable ? 0.3 : initials.length > 1 ? 0.38 : 0.46));

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#1F3A0E',
          color: '#B6F36A',
          fontSize,
          fontFamily: geist ? 'Geist' : undefined,
          fontWeight: 800,
          letterSpacing: '-0.04em'
        }}
      >
        {initials}
      </div>
    ),
    {
      width: size,
      height: size,
      fonts: geist ? [{ name: 'Geist', data: geist, weight: 800, style: 'normal' }] : undefined,
      headers
    }
  );
}
