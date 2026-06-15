export const ADMIN_Z_INDEX = {
  shellHeader: 50,
  shellSidebar: 120,
  dropdown: 300,
  stickyBar: 400,
  drawerBackdrop: 2147483140,
  drawer: 2147483150,
  modalBackdrop: 2147483190,
  modal: 2147483200,
  modalStacked: 2147483300,
  modalCritical: 2147483400,
  datepickerInOverlay: 2147483500,
  toast: 2147483600,
} as const;

export const ADMIN_Z_INDEX_CLASS = {
  drawer: 'z-[2147483150]',
  modal: 'z-[2147483200]',
  modalStacked: 'z-[2147483300]',
  modalCritical: 'z-[2147483400]',
  datepickerInOverlay: 'z-[2147483500]',
  toast: 'z-[2147483600]',
} as const;
