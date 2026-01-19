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
  const [role, setRole] = useState('MEMBER');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        await login(email, password);
        window.location.href = '/';
      } else {
        await register(firstName, lastName, email, password, phoneNumber, role);
        setError('Usuario registrado exitosamente. Ahora puedes iniciar sesión.');
        setIsLogin(true);
        setFirstName(''); setLastName(''); setPhoneNumber(''); setRole('MEMBER');
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
                  <input
                    id="phone-number"
                    type="tel"
                    required
                    placeholder=" "
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    className="peer w-full bg-surface border border-border rounded-lg px-4 pt-5 pb-3 text-text focus:outline-none focus:border-white focus:!border-white focus:ring-0 transition-colors placeholder:text-muted"
                  />
                  <label
                    htmlFor="phone-number"
                    className="absolute left-3 top-0 -translate-y-1/2 bg-surface px-1 text-muted text-sm transition-all pointer-events-none peer-focus:top-0 peer-focus:bg-surface peer-focus:px-1 peer-focus:text-xs peer-focus:text-slate-300 peer-placeholder-shown:top-1/2 peer-placeholder-shown:bg-transparent peer-placeholder-shown:px-0 peer-placeholder-shown:text-sm peer-[&:not(:placeholder-shown)]:top-0 peer-[&:not(:placeholder-shown)]:text-xs"
                  >
                    Teléfono
                  </label>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1 uppercase">Rol</label>
                  <select
                    required
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="w-full bg-surface border border-border rounded-lg px-4 py-3 text-text focus:outline-none transition-colors"
                  >
                    <option value="MEMBER">Miembro</option>
                    <option value="ADMIN">Administrador</option>
                  </select>
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

            <button type="submit" disabled={loading} className={`w-full mt-6 ${loading ? 'btn-disabled' : 'btn btn-primary'}`}>
              {loading ? 'Procesando...' : (isLogin ? 'INGRESAR' : 'REGISTRARSE')}
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