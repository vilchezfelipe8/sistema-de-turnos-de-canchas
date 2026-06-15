# Pique brand assets

Fuente de verdad del paquete visual Pique.

## Logo principal horizontal
- `pique-logo-horizontal.svg`: versión oficial por defecto para fondos claros.
- `pique-logo-horizontal-light.svg`: alias de la versión para fondos claros.
- `pique-logo-horizontal-dark.svg`: versión para fondos oscuros.

## Isotipo
- `pique-isotipo.svg`: mark oficial para app icon, favicon, sidebar y loaders.
- `pique-isotipo-dark.svg`: mark para fondos oscuros cuando conviene usar contorno claro.

## Compatibilidad
- `/pique-isotipo-root.svg` contiene el mismo isotipo oficial que `brand/pique-isotipo.svg`.
- `/brand/pique-isotipo.svg` es el isotipo oficial; el archivo raíz compatible replica esa marca y no debe usarse como fuente nueva.

## Raster generados
- `/favicon.ico`
- `/favicon-32.png`
- `/favicon-48.png`
- `/favicon-192.png`
- `/favicon-512.png`
- `/og-1200x630.png`

Regeneración: `npm --prefix apps/frontend run generate-icons`.
