let lockCount = 0;
let previousOverflow: string | null = null;

export const lockBodyScroll = (): (() => void) => {
  if (typeof document === 'undefined') {
    return () => {};
  }

  const bodyStyle = document.body.style;
  if (lockCount === 0) {
    previousOverflow = bodyStyle.overflow;
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
      previousOverflow = null;
    }
  };
};
