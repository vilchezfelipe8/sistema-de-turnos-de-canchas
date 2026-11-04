import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { ChevronRight, Copy, Instagram, Mail, Phone, X } from 'lucide-react';
import { reportUiError } from '../utils/uiError';

// general: dudas sobre Pique · owner: un complejo que quiere sumarse.
export type ContactMode = 'general' | 'owner';

interface ContactPanelProps {
  open: boolean;
  mode?: ContactMode;
  onClose: () => void;
}

const WHATSAPP_NUMBER = '5493513436163';
const SUPPORT_EMAIL = 'soporte.pique@gmail.com';
const INSTAGRAM_HANDLE = 'pique.ar_';

const COPY: Record<ContactMode, { title: string; intro: string; whatsappText: string; emailSubject: string }> = {
  general: {
    title: '¿En qué te ayudamos?',
    intro: 'Escribinos por el canal que prefieras.',
    whatsappText: 'Hola, tengo una consulta sobre Pique.',
    emailSubject: 'Consulta sobre Pique',
  },
  owner: {
    title: 'Sumá tu complejo',
    intro: 'Contanos dónde está tu complejo y te mostramos cómo funciona Pique.',
    whatsappText: 'Hola, tengo un complejo en ___ y quiero sumarme a Pique.',
    emailSubject: 'Quiero sumar mi complejo a Pique',
  },
};

const notify = (message: string) => {
  window.dispatchEvent(new CustomEvent('app:notice', { detail: { message, tone: 'success' } }));
};

// Panel único de contacto (inicio y resto de las páginas). Estilos en pique.css (.p-contact-*).
// Cada fila abre el canal directo; el botón de la derecha copia el dato.
export default function ContactPanel({ open, mode = 'general', onClose }: ContactPanelProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const copy = COPY[mode];

  // Al abrir, el foco va al panel; al cerrar, vuelve a donde estaba.
  useEffect(() => {
    if (!open) return undefined;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      returnFocusRef.current?.focus?.({ preventScroll: true });
    };
  }, [open, onClose]);

  const channels = [
    {
      key: 'whatsapp',
      label: 'WhatsApp',
      value: '+54 351 343 6163',
      href: `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(copy.whatsappText)}`,
      copyText: '+54 351 343 6163',
      icon: <Phone size={16} />,
    },
    {
      key: 'email',
      label: 'Email',
      value: SUPPORT_EMAIL,
      href: `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(copy.emailSubject)}`,
      copyText: SUPPORT_EMAIL,
      icon: <Mail size={16} />,
    },
    {
      key: 'instagram',
      label: 'Instagram',
      value: `@${INSTAGRAM_HANDLE}`,
      href: `https://www.instagram.com/${INSTAGRAM_HANDLE}/`,
      copyText: `@${INSTAGRAM_HANDLE}`,
      icon: <Instagram size={16} />,
    },
  ];

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify(`Copiado: ${text}`);
    } catch (error) {
      reportUiError({ area: 'ContactPanel', action: 'copyContact' }, error);
    }
  };

  return (
    <>
      <div className={`p-contact-overlay${open ? ' p-open' : ''}`} onClick={onClose} aria-hidden="true" />
      <div
        className={`p-contact-panel${open ? ' p-open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="p-contact-title"
        aria-hidden={!open}
      >
        <div className="p-contact-head">
          <h2 id="p-contact-title" className="p-contact-title">{copy.title}</h2>
          <button ref={closeButtonRef} type="button" className="p-public-close-btn" onClick={onClose} aria-label="Cerrar" tabIndex={open ? 0 : -1}>
            <X size={15} />
          </button>
        </div>
        <div className="p-contact-body">
          <p className="p-contact-intro">{copy.intro}</p>
          {channels.map((channel) => (
            <div key={channel.key} className="p-contact-row">
              <a className="p-contact-link" href={channel.href} target="_blank" rel="noopener noreferrer" tabIndex={open ? 0 : -1}>
                <span className="p-contact-icon" aria-hidden="true">{channel.icon}</span>
                <span className="p-contact-text">
                  <span className="p-contact-label">{channel.label}</span>
                  <span className="p-contact-value">{channel.value}</span>
                </span>
                <ChevronRight size={16} className="p-contact-go" aria-hidden="true" />
              </a>
              <button
                type="button"
                className="p-contact-copy"
                onClick={() => { void handleCopy(channel.copyText); }}
                aria-label={`Copiar ${channel.label}`}
                title="Copiar"
                tabIndex={open ? 0 : -1}
              >
                <Copy size={15} />
              </button>
            </div>
          ))}
          {mode === 'general' && (
            <p className="p-contact-note">
              ¿Algo con una reserva? Lo resuelve el club: su teléfono está en la página del club, en Información.{' '}
              <Link href="/complejos" onClick={onClose} tabIndex={open ? 0 : -1}>Ver complejos</Link>
            </p>
          )}
        </div>
      </div>
    </>
  );
}
