let lockCount = 0;
let previousOverflow: string | null = null;
let previousPaddingRight: string | null = null;

// Bloquea el scroll de la página (modales, hojas). Al ocultarse la barra de scroll la página
// ganaría ese ancho y se correría: se compensa con padding en el body y, para lo fijo
// (navbar), con la variable --p-scrollbar-comp. Sin barra (celulares, páginas cortas) no hace nada.
export const lockBodyScroll = (): (() => void) => {
  if (typeof document === 'undefined') {
    return () => {};
  }

  const root = document.documentElement;
  const bodyStyle = document.body.style;
  if (lockCount === 0) {
    previousOverflow = bodyStyle.overflow;
    previousPaddingRight = bodyStyle.paddingRight;
    const scrollbarWidth = window.innerWidth - root.clientWidth;
    if (scrollbarWidth > 0) {
      const currentPadding = parseFloat(window.getComputedStyle(document.body).paddingRight) || 0;
      bodyStyle.paddingRight = `${currentPadding + scrollbarWidth}px`;
      root.style.setProperty('--p-scrollbar-comp', `${scrollbarWidth}px`);
    }
    bodyStyle.overflow = 'hidden';
  }
  lockCount += 1;

  let released = false;
  return () => {
    if (released || typeof document === 'undefined') return;
    released = true;
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0) {
      document.body.style.overflow = previousOverflow ?? '';
      document.body.style.paddingRight = previousPaddingRight ?? '';
      document.documentElement.style.removeProperty('--p-scrollbar-comp');
      previousOverflow = null;
      previousPaddingRight = null;
    }
  };
};
