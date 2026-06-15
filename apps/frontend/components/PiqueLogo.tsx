import type { CSSProperties } from 'react';
import Image from 'next/image';

export const PIQUE_LOGO_ASSETS = {
  horizontal: '/brand/pique-logo-horizontal.svg',
  horizontalLight: '/brand/pique-logo-horizontal-light.svg',
  horizontalDark: '/brand/pique-logo-horizontal-dark.svg',
  horizontalTagline: '/brand/pique-logo-horizontal-tagline.svg',
  isotipo: '/brand/pique-isotipo.svg',
  isotipoDark: '/brand/pique-isotipo-dark.svg',
} as const;

type PiqueLogoVariant = keyof typeof PIQUE_LOGO_ASSETS;

type PiqueLogoProps = {
  variant?: PiqueLogoVariant;
  className?: string;
  style?: CSSProperties;
  alt?: string;
};

const PIQUE_LOGO_DIMENSIONS: Record<PiqueLogoVariant, { width: number; height: number }> = {
  horizontal: { width: 196, height: 64 },
  horizontalLight: { width: 196, height: 64 },
  horizontalDark: { width: 196, height: 64 },
  horizontalTagline: { width: 320, height: 72 },
  isotipo: { width: 64, height: 64 },
  isotipoDark: { width: 64, height: 64 },
};

export default function PiqueLogo({
  variant = 'horizontal',
  className,
  style,
  alt = 'pique',
}: PiqueLogoProps) {
  const dimensions = PIQUE_LOGO_DIMENSIONS[variant];

  return (
    <Image
      src={PIQUE_LOGO_ASSETS[variant]}
      alt={alt}
      width={dimensions.width}
      height={dimensions.height}
      className={className}
      style={style}
      draggable={false}
      priority={false}
      unoptimized
    />
  );
}
