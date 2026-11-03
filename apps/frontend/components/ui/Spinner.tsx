import { Loader2 } from 'lucide-react';

interface SpinnerProps {
  size?: number;
  className?: string;
}

// Spinner de acciones (botones, búsquedas). La animación vive en pique.css (.p-spin).
export default function Spinner({ size = 15, className }: SpinnerProps) {
  return <Loader2 size={size} className={`p-spin${className ? ` ${className}` : ''}`} aria-hidden="true" />;
}
