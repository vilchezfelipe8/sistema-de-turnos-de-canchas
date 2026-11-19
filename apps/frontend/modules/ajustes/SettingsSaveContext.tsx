import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/router';
import AdminAppModal from '../../components/admin/ui/AdminAppModal';
import { ADMIN_Z_INDEX } from '../../utils/adminZIndex';
import { showAdminToast } from '../../utils/adminToast';
import { adminButton } from '../../components/admin/ui/adminButton';

// Guardado único de una página de Ajustes: cada tarjeta registra sus cambios
// pendientes y la página muestra una sola barra "Guardar cambios / Descartar".

type SaveSlot = {
  /** Cantidad de cambios pendientes (0 = nada que guardar). */
  changes: number;
  /** Guarda. Devuelve false si falló o se canceló (la tarjeta muestra el error). */
  save: () => Promise<boolean>;
  /** Vuelve a lo último guardado. */
  discard: () => void;
};

type SettingsSaveContextValue = {
  setSlot: (id: string, slot: SaveSlot | null) => void;
  saving: boolean;
  /** Sube cada vez que la página termina de guardar. */
  savedVersion: number;
};

const SettingsSaveContext = createContext<SettingsSaveContextValue | null>(null);

const NAVIGATION_ABORT = '__SETTINGS_UNSAVED_ABORT__';

export const useInSettingsSavePage = () => useContext(SettingsSaveContext) !== null;

/** Para recargar datos que dependen de otra tarjeta de la misma página. */
export const useSettingsSavedVersion = () => useContext(SettingsSaveContext)?.savedVersion ?? 0;

/** Registra una tarjeta en la barra de guardado de la página (si la hay). */
export function useSettingsSaveSlot(id: string, slot: SaveSlot) {
  const ctx = useContext(SettingsSaveContext);
  const slotRef = useRef(slot);
  slotRef.current = slot;
  const setSlot = ctx?.setSlot;

  useEffect(() => {
    if (!setSlot) return;
    setSlot(id, {
      changes: slot.changes,
      save: () => slotRef.current.save(),
      discard: () => slotRef.current.discard(),
    });
  }, [setSlot, id, slot.changes]);

  useEffect(() => {
    if (!setSlot) return;
    return () => setSlot(id, null);
  }, [setSlot, id]);

  return { saving: ctx?.saving ?? false, managed: Boolean(ctx) };
}

type ModalState = {
  show: boolean;
  title?: string;
  message?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
};

export function SettingsSaveProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [slots, setSlots] = useState<Record<string, SaveSlot>>({});
  const [saving, setSaving] = useState(false);
  const [savedVersion, setSavedVersion] = useState(0);
  const [modal, setModal] = useState<ModalState>({ show: false });
  const allowNavigationRef = useRef(false);

  const setSlot = useCallback((id: string, slot: SaveSlot | null) => {
    setSlots((prev) => {
      if (!slot) {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return { ...prev, [id]: slot };
    });
  }, []);

  const dirtySlots = useMemo(() => Object.values(slots).filter((slot) => slot.changes > 0), [slots]);
  const totalChanges = dirtySlots.reduce((sum, slot) => sum + slot.changes, 0);
  const hasChanges = totalChanges > 0;

  const closeModal = () => setModal({ show: false });

  const discardAll = useCallback(() => {
    dirtySlots.forEach((slot) => slot.discard());
  }, [dirtySlots]);

  const handleSaveAll = async () => {
    if (saving || !hasChanges) return;
    setSaving(true);
    let allOk = true;
    try {
      for (const slot of dirtySlots) {
        // Una tarjeta que falla no frena a las demás; cada una muestra su error.
        // eslint-disable-next-line no-await-in-loop
        const ok = await slot.save().catch(() => false);
        if (!ok) allOk = false;
      }
    } finally {
      setSaving(false);
      setSavedVersion((value) => value + 1);
    }
    if (allOk) showAdminToast('Cambios guardados.');
  };

  const handleDiscard = () => {
    setModal({
      show: true,
      title: 'Descartar cambios',
      message: 'Se pierden los cambios que no guardaste en esta página.',
      cancelText: 'Volver',
      confirmText: 'Descartar',
      onConfirm: () => {
        closeModal();
        discardAll();
      },
    });
  };

  useEffect(() => {
    if (!hasChanges) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasChanges]);

  useEffect(() => {
    const onRouteChangeStart = (url: string) => {
      if (allowNavigationRef.current || !hasChanges || url === router.asPath) return;
      setModal({
        show: true,
        title: 'Cambios sin guardar',
        message: 'Si salís ahora, se pierden los cambios que no guardaste.',
        cancelText: 'Quedarme',
        confirmText: 'Salir sin guardar',
        onCancel: closeModal,
        onConfirm: async () => {
          closeModal();
          discardAll();
          allowNavigationRef.current = true;
          try {
            await router.push(url);
          } finally {
            allowNavigationRef.current = false;
          }
        },
      });
      router.events.emit('routeChangeError');
      throw NAVIGATION_ABORT;
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (event.reason === NAVIGATION_ABORT) event.preventDefault();
    };
    router.events.on('routeChangeStart', onRouteChangeStart);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => {
      router.events.off('routeChangeStart', onRouteChangeStart);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, [hasChanges, router, discardAll]);

  const value = useMemo(() => ({ setSlot, saving, savedVersion }), [setSlot, saving, savedVersion]);

  return (
    <SettingsSaveContext.Provider value={value}>
      <div className={`transition-[padding-bottom] duration-200 ${hasChanges ? 'pb-20' : ''}`}>{children}</div>

      <div
        className={`fixed bottom-0 left-0 right-0 transition-transform duration-200 ease-out lg:left-[var(--admin-shell-sidebar-left,168px)] ${
          hasChanges ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{ zIndex: ADMIN_Z_INDEX.stickyBar }}
        aria-hidden={!hasChanges}
      >
        <div className="flex items-center gap-3 border-t border-p-border bg-p-surface px-5 py-3 shadow-p-lg">
          <span className="h-2 w-2 shrink-0 rounded-full bg-p-warning" />
          <span className="text-[12px] font-medium text-p-text">
            {totalChanges} cambio{totalChanges !== 1 ? 's' : ''} sin guardar
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={handleDiscard}
              disabled={saving}
              className={adminButton('secondary', 'sm')}
            >
              Descartar
            </button>
            <button
              type="button"
              onClick={() => void handleSaveAll()}
              disabled={saving}
              className={adminButton('primary', 'sm')}
            >
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </div>
      </div>

      <AdminAppModal
        show={modal.show}
        onClose={closeModal}
        onCancel={modal.onCancel ?? closeModal}
        title={modal.title}
        message={modal.message}
        cancelText={modal.cancelText}
        confirmText={modal.confirmText}
        isWarning
        onConfirm={modal.onConfirm}
      />
    </SettingsSaveContext.Provider>
  );
}
