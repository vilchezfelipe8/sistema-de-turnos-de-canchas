import Link from 'next/link';
import PiqueLogo from './PiqueLogo';
import { useAuth } from '../contexts/AuthContext';
import { useUserTheme } from '../contexts/UserThemeContext';

interface PublicFooterProps {
  // Abre el panel de contacto. Sin él, el link "Contacto" no se muestra.
  onContactClick?: () => void;
}

// Footer único de las páginas públicas (inicio incluido). Estilos en pique.css (.p-legal-footer).
export default function PublicFooter({ onContactClick }: PublicFooterProps) {
  const { user } = useAuth();
  const { isLight } = useUserTheme();
  const currentYear = new Date().getFullYear();

  return (
    <footer className="p-legal-footer">
      <div className="p-legal-footer-inner">
        <div className="p-legal-footer-brand">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <PiqueLogo variant={isLight ? 'horizontal' : 'horizontalDark'} style={{ width: 82, height: 'auto', display: 'block' }} />
          </span>
          <p className="p-legal-footer-copy">Reservá canchas y gestioná tu complejo en un solo lugar.</p>
        </div>

        <div className="p-legal-footer-groups">
          <div className="p-legal-footer-group">
            <p className="p-legal-footer-title">Explorar</p>
            <nav className="p-legal-footer-links" aria-label="Explorar Pique">
              <Link href="/" className="p-legal-footer-link">Inicio</Link>
              <Link href="/complejos" className="p-legal-footer-link">Complejos</Link>
            </nav>
          </div>

          <div className="p-legal-footer-group">
            <p className="p-legal-footer-title">Ayuda</p>
            <nav className="p-legal-footer-links" aria-label="Ayuda y legal">
              {onContactClick && (
                <button type="button" className="p-legal-footer-link p-legal-footer-button" onClick={onContactClick}>Contacto</button>
              )}
              <Link href="/legal/privacy" className="p-legal-footer-link">Privacidad</Link>
              <Link href="/legal/terms" className="p-legal-footer-link">Términos</Link>
            </nav>
          </div>

          <div className="p-legal-footer-group">
            <p className="p-legal-footer-title">Cuenta</p>
            <nav className="p-legal-footer-links" aria-label="Cuenta">
              {user ? (
                <>
                  <Link href="/bookings" className="p-legal-footer-link">Mis reservas</Link>
                  <Link href="/perfil" className="p-legal-footer-link">Mi perfil</Link>
                </>
              ) : (
                <Link href="/login" className="p-legal-footer-link">Ingresar</Link>
              )}
            </nav>
          </div>
        </div>

        <div className="p-legal-footer-meta">© {currentYear} Pique</div>
      </div>
    </footer>
  );
}
