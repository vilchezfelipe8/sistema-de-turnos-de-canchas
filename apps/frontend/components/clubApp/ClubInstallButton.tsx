import { useEffect, useState } from 'react';
import Image from 'next/image';
import { createPortal } from 'react-dom';
import { Share, Smartphone, SquarePlus } from 'lucide-react';
import { canPromptPwaInstall, getIosBrowser, promptPwaInstall, subscribePwaInstall, type IosBrowser } from '../../utils/pwaInstall';
import { clubInitials, isStandaloneDisplay } from '../../utils/clubApp';
import { lockBodyScroll } from '../../utils/bodyScrollLock';
import { reportUiError } from '../../utils/uiError';

const INSTALL_CSS = `
  .cl-install-btn { width:auto; padding:0 14px; gap:8px; color:var(--accent-fg); font-family:var(--font-sans); font-size:13px; font-weight:800; letter-spacing:.01em; white-space:nowrap; }
  .ci-overlay { position:fixed; inset:0; z-index:2147483000; background:var(--overlay); display:flex; align-items:flex-end; justify-content:center; }
  .ci-sheet { width:100%; max-width:520px; border-radius:28px 28px 0 0; background:var(--surface-1); border:1px solid var(--border); border-bottom:0; padding:12px 20px calc(24px + env(safe-area-inset-bottom)); display:flex; flex-direction:column; gap:16px; font-family:var(--font-sans); color:var(--text-primary); }
  .ci-grabber { align-self:center; width:40px; height:4px; border-radius:999px; background:var(--border-strong); }
  .ci-head { display:flex; align-items:center; gap:14px; }
  .ci-mark { position:relative; width:54px; height:54px; flex-shrink:0; border-radius:16px; overflow:hidden; background:var(--brand-on); color:var(--brand); border:1px solid var(--accent-border-subtle); display:flex; align-items:center; justify-content:center; font-size:18px; font-weight:900; letter-spacing:-.02em; }
  .ci-mark img { background:var(--surface-1); }
  .ci-title { margin:0; color:var(--text-primary); font-size:20px; font-weight:900; letter-spacing:-.02em; line-height:1.25; }
  .ci-copy { margin:4px 0 0; color:var(--text-secondary); font-size:14px; line-height:1.45; font-weight:600; }
  .ci-step { display:flex; align-items:center; gap:14px; padding:16px; border-radius:18px; background:var(--surface-2); }
  .ci-step-num { width:36px; height:36px; flex-shrink:0; border-radius:999px; background:var(--brand); color:var(--brand-on); display:flex; align-items:center; justify-content:center; font-size:16px; font-weight:900; }
  .ci-step-text { margin:0; flex:1; font-size:16px; line-height:1.4; font-weight:700; }
  .ci-step-icon { width:44px; height:44px; flex-shrink:0; border-radius:12px; border:1px solid var(--border-strong); color:var(--text-primary); display:flex; align-items:center; justify-content:center; }
  .ci-note { margin:0; color:var(--text-secondary); font-size:14px; line-height:1.5; font-weight:600; text-align:center; }
  .ci-primary { width:100%; height:52px; display:inline-flex; align-items:center; justify-content:center; border:0; border-radius:16px; background:var(--brand); color:var(--brand-on); font-family:var(--font-sans); font-size:15px; font-weight:900; cursor:pointer; }
  .ci-primary:hover { background:var(--brand-hover); }
`;

type Props = { clubName: string; logoUrl?: string | null };

// "Instalar app" junto a favorito y compartir: discreto y siempre a mano. Solo aparece si el navegador
// permite instalar (Android/computadora) o en iPhone (con los dos pasos), y nunca dentro de la app instalada.
export default function ClubInstallButton({ clubName, logoUrl }: Props) {
  const [canPrompt, setCanPrompt] = useState(false);
  const [iosBrowser, setIosBrowser] = useState<IosBrowser | null>(null);
  const [iosSheetOpen, setIosSheetOpen] = useState(false);

  useEffect(() => {
    if (isStandaloneDisplay()) return;
    setIosBrowser(getIosBrowser());
    const sync = () => setCanPrompt(canPromptPwaInstall());
    sync();
    return subscribePwaInstall(sync);
  }, []);

  useEffect(() => {
    if (!iosSheetOpen) return;
    const release = lockBodyScroll();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setIosSheetOpen(false); };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      release();
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [iosSheetOpen]);

  if (!canPrompt && !iosBrowser) return null;

  const handleInstall = async () => {
    if (iosBrowser) {
      setIosSheetOpen(true);
      return;
    }
    try {
      await promptPwaInstall();
    } catch (error) {
      reportUiError({ area: 'ClubInstallButton', action: 'promptInstall' }, error);
    }
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: INSTALL_CSS }} />
      <button
        type="button"
        className="cl-icon-btn cl-install-btn"
        onClick={() => void handleInstall()}
        title={`Agregá ${clubName} a tu pantalla de inicio`}
      >
        <Smartphone size={18} />
        Instalar app
      </button>

      {iosSheetOpen && typeof document !== 'undefined' && createPortal(
        <div className="ci-overlay" onClick={() => setIosSheetOpen(false)}>
          <div className="ci-sheet" role="dialog" aria-modal="true" aria-labelledby="ci-ios-title" onClick={(event) => event.stopPropagation()}>
            <span className="ci-grabber" aria-hidden="true" />
            <div className="ci-head">
              <span className="ci-mark" aria-hidden="true">
                {logoUrl
                  ? <Image src={logoUrl} alt="" fill sizes="54px" style={{ objectFit: 'contain' }} unoptimized />
                  : clubInitials(clubName)}
              </span>
              <div>
                <p id="ci-ios-title" className="ci-title">Agregá el club a tu iPhone</p>
                <p className="ci-copy">Son dos pasos, una sola vez.</p>
              </div>
            </div>
            <div className="ci-step">
              <span className="ci-step-num">1</span>
              <p className="ci-step-text">
                {iosBrowser === 'chrome'
                  ? <>Tocá el botón <strong>Compartir</strong> de arriba, al lado de la dirección</>
                  : iosBrowser === 'other'
                    ? <>Abrí el menú del navegador y tocá <strong>Compartir</strong></>
                    : <>Tocá el botón <strong>Compartir</strong> de abajo de la pantalla</>}
              </p>
              <span className="ci-step-icon" aria-hidden="true"><Share size={20} /></span>
            </div>
            <div className="ci-step">
              <span className="ci-step-num">2</span>
              <p className="ci-step-text">Elegí <strong>Agregar a inicio</strong> (o <strong>Agregar a pantalla de inicio</strong>) y después <strong>Agregar</strong></p>
              <span className="ci-step-icon" aria-hidden="true"><SquarePlus size={20} /></span>
            </div>
            <p className="ci-note">Vas a ver el ícono de {clubName} en tu pantalla, como cualquier otra app.</p>
            <button type="button" className="ci-primary" onClick={() => setIosSheetOpen(false)}>Entendido</button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
