import type { CSSProperties } from 'react';

interface SkeletonProps {
  width?: CSSProperties['width'];
  height?: CSSProperties['height'];
  radius?: CSSProperties['borderRadius'];
  variant?: 'block' | 'line' | 'circle';
  className?: string;
  style?: CSSProperties;
}

// Bloque de carga con la forma del contenido que viene. Estilos en pique.css (.p-skel).
export default function Skeleton({ width, height, radius, variant = 'block', className, style }: SkeletonProps) {
  const variantClass = variant === 'line' ? ' p-skel-line' : variant === 'circle' ? ' p-skel-circle' : '';
  return (
    <span
      className={`p-skel${variantClass}${className ? ` ${className}` : ''}`}
      style={{ width, height, borderRadius: radius, ...style }}
      aria-hidden="true"
    />
  );
}

// Varias líneas de texto simuladas; la última más corta.
export function SkeletonText({ lines = 3, gap = 10 }: { lines?: number; gap?: number }) {
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap }} aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} variant="line" width={index === lines - 1 && lines > 1 ? '60%' : '100%'} />
      ))}
    </span>
  );
}
