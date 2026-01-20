import { useState } from 'react';
import { useRouter } from 'next/router'; 
import { login, register } from '../services/AuthService'; 
// Ajusta los imports de servicios según tu estructura

export default function LoginPage() {
  // const router = useRouter(); // Descomentar si usas router para redirigir
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('admin@local.test');
  const [password, setPassword] = useState('admin123');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [phoneFocused, setPhoneFocused] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const isPhoneValid = (phone: string) => {
    if (!phone) return false;
    if (!phone.startsWith('+549')) return false;
    const digits = phone.replace(/\D/g, '');
    if (!digits.startsWith('549')) return false;
    const nationalDigits = digits.slice(3);
    if (nationalDigits.length !== 10) return false;
    return /^\+549\d+$/.test(phone);
  };

  const formatPhoneDigits = (digits: string) => {
    const clean = digits.slice(0, 10);
    const part1 = clean.slice(0, 3);
    const part2 = clean.slice(3, 6);
    const part3 = clean.slice(6, 10);
    return [part1, part2, part3].filter(Boolean).join(' ');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        await login(email, password);
        window.location.href = '/';
      } else {
        const phoneDigits = phoneNumber.replace(/\D/g, '').slice(0, 10);
        const fullPhone = phoneDigits ? `+549${phoneDigits}` : '';
        if (!phoneDigits) {
          setError('Ingresá un teléfono para completar el registro.');
          return;
        }
        if (!isPhoneValid(fullPhone)) {
          setError('Ingresá un teléfono con formato válido.');
          return;
        }
        await register(firstName, lastName, email, password, fullPhone, 'MEMBER');
        setError('Usuario registrado exitosamente. Ahora puedes iniciar sesión.');
        setIsLogin(true);
        setFirstName(''); setLastName(''); setPhoneNumber('');
      }
    } catch (err: any) {
      setError(err.message || (isLogin ? 'Credenciales inválidas' : 'Error al registrar'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4 relative overflow-hidden" style={{ backgroundColor: 'var(--bg)' }}>
      
      {/* Decoración de Fondo */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0">
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] rounded-full blur-[100px]" style={{ backgroundColor: 'rgba(255,255,255,0.03)' }}></div>
        <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] rounded-full blur-[100px]" style={{ backgroundColor: 'rgba(255,255,255,0.02)' }}></div>
      </div>

      <div className="w-full max-w-md relative z-10">


        {/* Card Glassmorphism */}
        <div className="bg-surface-70 backdrop-blur-xl rounded-3xl p-8 border" style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-2xl font-bold text-center mb-6 text-white">
            {isLogin ? 'Iniciar Sesión' : 'Crear Cuenta'}
          </h2>
          
          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/50 text-red-400 rounded-xl text-sm flex items-center gap-3">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="relative">
                    <input
                      id="first-name"
                      type="text"
                      required
                      placeholder=" "
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="peer w-full bg-surface border border-border rounded-lg px-4 pt-5 pb-3 text-text focus:outline-none focus:border-white focus:!border-white focus:ring-0 transition-colors placeholder:text-muted"
                    />
                    <label
                      htmlFor="first-name"
                      className="absolute left-3 top-0 -translate-y-1/2 bg-surface px-1 text-muted text-sm transition-all pointer-events-none peer-focus:top-0 peer-focus:bg-surface peer-focus:px-1 peer-focus:text-xs peer-focus:text-slate-300 peer-placeholder-shown:top-1/2 peer-placeholder-shown:bg-transparent peer-placeholder-shown:px-0 peer-placeholder-shown:text-sm peer-[&:not(:placeholder-shown)]:top-0 peer-[&:not(:placeholder-shown)]:text-xs"
                    >
                      Nombre
                    </label>
                  </div>
                  <div className="relative">
                    <input
                      id="last-name"
                      type="text"
                      required
                      placeholder=" "
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className="peer w-full bg-surface border border-border rounded-lg px-4 pt-5 pb-3 text-text focus:outline-none focus:border-white focus:!border-white focus:ring-0 transition-colors placeholder:text-muted"
                    />
                    <label
                      htmlFor="last-name"
                      className="absolute left-3 top-0 -translate-y-1/2 bg-surface px-1 text-muted text-sm transition-all pointer-events-none peer-focus:top-0 peer-focus:bg-surface peer-focus:px-1 peer-focus:text-xs peer-focus:text-slate-300 peer-placeholder-shown:top-1/2 peer-placeholder-shown:bg-transparent peer-placeholder-shown:px-0 peer-placeholder-shown:text-sm peer-[&:not(:placeholder-shown)]:top-0 peer-[&:not(:placeholder-shown)]:text-xs"
                    >
                      Apellido
                    </label>
                  </div>
                </div>
                <div className="relative">
                  <div className="relative flex items-center rounded-lg border border-border bg-surface focus-within:border-white focus-within:!border-white transition-colors">
                    <span
                      className={`px-3 text-muted font-medium whitespace-nowrap min-w-[3.25rem] text-center transition-all duration-150 ${phoneNumber.length || phoneFocused ? 'mt-1.5' : ''}`}
                    >
                      +54&nbsp;9
                    </span>
                    <input
                      id="phone-number"
                      type="tel"
                      required
                      placeholder=" "
                      value={formatPhoneDigits(phoneNumber)}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, '');
                        setPhoneNumber(digits);
                      }}
                      onFocus={() => setPhoneFocused(true)}
                      onBlur={() => setPhoneFocused(false)}
                      maxLength={12}
                      className="peer w-full bg-transparent px-4 pt-5 pb-3 text-text focus:outline-none focus:border-0 focus:ring-0 transition-colors placeholder:text-muted border-0"
                    />
                    <label
                      htmlFor="phone-number"
                      className="absolute left-16 top-0 -translate-y-1/2 bg-surface px-1 text-muted text-sm transition-all pointer-events-none peer-focus:top-0 peer-focus:bg-surface peer-focus:px-1 peer-focus:text-xs peer-focus:text-slate-300 peer-placeholder-shown:top-1/2 peer-placeholder-shown:bg-transparent peer-placeholder-shown:px-0 peer-placeholder-shown:text-sm peer-[&:not(:placeholder-shown)]:top-0 peer-[&:not(:placeholder-shown)]:text-xs"
                    >
                      Teléfono
                    </label>
                  </div>
                </div>
              </>
            )}
            
            <div className="relative">
              <input
                id="login-email"
                type="email"
                required
                placeholder=" "
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="peer w-full bg-surface border border-border rounded-lg px-4 pt-5 pb-3 text-text focus:outline-none focus:border-white focus:!border-white focus:ring-0 transition-colors placeholder:text-muted"
              />
              <label
                htmlFor="login-email"
                className="absolute left-3 top-0 -translate-y-1/2 bg-surface px-1 text-muted text-sm transition-all pointer-events-none peer-focus:top-0 peer-focus:bg-surface peer-focus:px-1 peer-focus:text-xs peer-focus:text-slate-300 peer-placeholder-shown:top-1/2 peer-placeholder-shown:bg-transparent peer-placeholder-shown:px-0 peer-placeholder-shown:text-sm peer-[&:not(:placeholder-shown)]:top-0 peer-[&:not(:placeholder-shown)]:text-xs"
              >
                Email
              </label>
            </div>

            <div className="relative">
              <input
                id="login-password"
                type="password"
                required
                placeholder=" "
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="peer w-full bg-surface border border-border rounded-lg px-4 pt-5 pb-3 text-text focus:outline-none focus:border-white focus:!border-white focus:ring-0 transition-colors placeholder:text-muted"
              />
              <label
                htmlFor="login-password"
                className="absolute left-3 top-0 -translate-y-1/2 bg-surface px-1 text-muted text-sm transition-all pointer-events-none peer-focus:top-0 peer-focus:bg-surface peer-focus:px-1 peer-focus:text-xs peer-focus:text-slate-300 peer-placeholder-shown:top-1/2 peer-placeholder-shown:bg-transparent peer-placeholder-shown:px-0 peer-placeholder-shown:text-sm peer-[&:not(:placeholder-shown)]:top-0 peer-[&:not(:placeholder-shown)]:text-xs"
              >
                Contraseña
              </label>
            </div>

            <button type="submit" disabled={loading} className={`w-full mt-6 btn h-11 ${loading ? 'btn-disabled' : 'btn-primary'}`}>
              {loading ? (
                <span className="inline-flex items-center justify-center" aria-label="Cargando">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                </span>
              ) : (isLogin ? 'INGRESAR' : 'REGISTRARSE')}
            </button>
          </form>

          <div className="mt-8 text-center">
            <button onClick={() => { setIsLogin(!isLogin); setError(''); }}
              className="text-slate-400 hover:text-white text-sm transition-colors hover:underline">
              {isLogin ? '¿No tienes cuenta? Regístrate' : '¿Ya tienes cuenta? Inicia sesión'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}