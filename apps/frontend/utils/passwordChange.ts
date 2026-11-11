export type PasswordChangeValues = {
  currentPassword: string;
  newPassword: string;
  confirmation: string;
};

export type PasswordChangeErrors = Partial<Record<keyof PasswordChangeValues, string>>;

// Match the change-password endpoint, including bcrypt's UTF-8 byte limit.
// Passwords are compared and sent exactly as typed; never trim them.
export const validatePasswordChange = (values: PasswordChangeValues): PasswordChangeErrors => {
  const errors: PasswordChangeErrors = {};
  if (!values.currentPassword) errors.currentPassword = 'Ingresá tu contraseña actual.';
  else if (values.currentPassword.length > 256) errors.currentPassword = 'La contraseña actual es demasiado larga.';

  if (!values.newPassword) errors.newPassword = 'Ingresá una nueva contraseña.';
  else if (values.newPassword.length < 8) errors.newPassword = 'Usá al menos 8 caracteres.';
  else if (new TextEncoder().encode(values.newPassword).length > 72) {
    errors.newPassword = 'La contraseña es demasiado larga. Elegí una más corta.';
  } else if (values.newPassword === values.currentPassword) {
    errors.newPassword = 'Elegí una contraseña diferente a la actual.';
  }

  if (!values.confirmation) errors.confirmation = 'Repetí la nueva contraseña.';
  else if (values.confirmation !== values.newPassword) errors.confirmation = 'Las contraseñas no coinciden.';
  return errors;
};
