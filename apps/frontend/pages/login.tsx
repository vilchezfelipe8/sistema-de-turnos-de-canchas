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
                  <div>
                    <label className="block text-xs font-bold text-slate-400 mb-1 uppercase">Nombre</label>
                    <input type="text" required value={firstName} onChange={(e) => setFirstName(e.target.value)}
                      className="w-full bg-surface border border-border rounded-lg px-4 py-3 text-text focus:outline-none transition-all placeholder:text-muted" placeholder="Nombre" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 mb-1 uppercase">Apellido</label>
                    <input type="text" required value={lastName} onChange={(e) => setLastName(e.target.value)}
                      className="w-full bg-surface border border-border rounded-lg px-4 py-3 text-text focus:outline-none transition-all placeholder:text-muted" placeholder="Apellido" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1 uppercase">Teléfono</label>
                  <input type="tel" required value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)}
                    className="w-full bg-surface border border-border rounded-lg px-4 py-3 text-text focus:outline-none transition-all placeholder:text-muted" placeholder="Ej: 351..." />
                </div>
                <div>
                   <label className="block text-xs font-bold text-slate-400 mb-1 uppercase">Rol</label>
                   <select required value={role} onChange={(e) => setRole(e.target.value)}
                     className="w-full bg-surface border border-border rounded-lg px-4 py-3 text-text focus:outline-none transition-all" >
                     <option value="MEMBER">Miembro</option>
                     <option value="ADMIN">Administrador</option>
                   </select>
                </div>
              </>
            )}
            
            <div>
              <label className="block text-xs font-bold text-muted mb-1 uppercase">Email</label>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-surface border border-border rounded-lg px-4 py-3 text-text focus:outline-none transition-all placeholder:text-muted" placeholder="tu@email.com" />
            </div>

            <div>
              <label className="block text-xs font-bold text-muted mb-1 uppercase">Contraseña</label>
              <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-surface border border-border rounded-lg px-4 py-3 text-text focus:outline-none transition-all placeholder:text-muted" placeholder="••••••••" />
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