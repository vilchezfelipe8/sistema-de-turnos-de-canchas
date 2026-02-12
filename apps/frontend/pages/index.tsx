import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { ClubService, Club } from '../services/ClubService';
// Agregamos iconos de contacto: Phone, Mail, Instagram, X (Cerrar)
import { Search, MapPin, Calendar, TrendingUp, ShieldCheck, ArrowRight, Menu, X, Phone, Mail, Instagram } from 'lucide-react';
import Link from 'next/link';

export default function Home() {
  const router = useRouter();
  const [clubs, setClubs] = useState<Club[]>([]);
  const [loadingClubs, setLoadingClubs] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [user, setUser] = useState<any>(null);
  
  // ESTADO NUEVO: Para controlar si el sidebar está abierto o cerrado
  const [showContact, setShowContact] = useState(false);

  useEffect(() => {
    const userStr = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
    if (userStr) {
        try {
            const parsedUser = JSON.parse(userStr);
            setUser(parsedUser);
        } catch {}
    }

    const loadClubs = async () => {
      try {
        const allClubs = await ClubService.getAllClubs();
        setClubs(allClubs);
      } catch (error) {
        console.error('Error al cargar clubes:', error);
      } finally {
        setLoadingClubs(false);
      }
    };
    loadClubs();
  }, []);

  const filteredClubs = clubs.filter(club => 
    club.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (club.address && club.address.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="min-h-screen relative overflow-x-hidden bg-[#347048] text-[#D4C5B0] selection:bg-[#B9CF32] selection:text-[#347048]">
      
      {/* NAVBAR */}
      <nav className="absolute top-0 left-0 right-0 z-50 px-6 py-6 flex justify-between items-center max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
            <span className="text-2xl font-black tracking-tighter text-[#D4C5B0] italic opacity-90 hover:opacity-100 transition-opacity cursor-pointer">
                TuCancha
            </span>
        </div>

        <div className="flex items-center gap-4">
            {/* BOTÓN CONTACTO (Reemplaza a "Mi Panel") */}
            {/* Al hacer clic, abre el Sidebar (setShowContact(true)) */}
            <button 
                onClick={() => setShowContact(true)}
                className="hidden md:flex items-center gap-2 px-5 py-2 rounded-full border border-[#D4C5B0]/30 text-[#D4C5B0] font-bold text-sm hover:bg-[#D4C5B0] hover:text-[#347048] transition-all"
            >
                <span>Contacto</span>
            </button>

            {/* Si está logueado, igual le mostramos el botón de Ingresar/Salir o Panel si querés, 
                pero acá dejé el de "Ingresar" fijo para dueños nuevos */}
            {!user && (
                <Link href="/login" className="px-5 py-2 rounded-full bg-[#D4C5B0] text-[#347048] font-bold hover:bg-[#B9CF32] transition-all text-sm shadow-lg shadow-[#347048]/50">
                    Ingresar
                </Link>
            )}
            
            {/* Botón hamburguesa para móviles que también abre contacto */}
            <button onClick={() => setShowContact(true)} className="md:hidden text-[#D4C5B0]">
                <Menu />
            </button>
        </div>
      </nav>

      {/* HERO SECTION */}
      <section className="relative pt-40 pb-20 px-4 flex flex-col items-center text-center">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-[#B9CF32]/10 rounded-full blur-[120px] -z-10 pointer-events-none" />
        
        <h1 className="text-5xl md:text-7xl font-black mb-6 tracking-tight text-[#D4C5B0]">
          Tu cancha, <span className="text-[#B9CF32]">al toque.</span>
        </h1>
        
        <p className="text-[#D4C5B0]/80 text-lg md:text-xl max-w-2xl mb-12 font-medium leading-relaxed">
          La forma más rápida de encontrar y reservar turno en los mejores clubes. <br className="hidden md:block"/> Sin llamadas, sin esperas.
        </p>

        {/* BUSCADOR */}
        <div className="relative w-full max-w-lg group z-20">
          <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none">
            <Search className="h-5 w-5 text-[#347048]/60 group-focus-within:text-[#347048] transition-colors" />
          </div>
          <input
            type="text"
            placeholder="Buscar por nombre o ciudad..."
            className="block w-full pl-12 pr-4 py-4 bg-[#EBE1D8] border-2 border-transparent focus:border-[#B9CF32] rounded-2xl text-[#347048] placeholder-[#347048]/50 focus:outline-none focus:ring-4 focus:ring-[#B9CF32]/30 transition-all shadow-2xl font-bold"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </section>

      {/* GRILLA DE CLUBES */}
      <section className="container mx-auto px-4 py-10 pb-32 max-w-6xl">
        <h2 className="text-2xl font-bold mb-8 flex items-center gap-2 text-[#D4C5B0]/90">
          <MapPin className="text-[#B9CF32]" /> Clubes Disponibles
        </h2>

        {loadingClubs ? (
           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1,2,3].map(i => (
                <div key={i} className="h-64 bg-[#D4C5B0]/5 rounded-3xl animate-pulse border border-[#D4C5B0]/10"></div>
              ))}
           </div>
        ) : filteredClubs.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredClubs.map((club) => (
              <Link key={club.id} href={`/club/${club.slug}`} className="group relative bg-[#EBE1D8] border border-transparent rounded-3xl overflow-hidden hover:scale-[1.02] transition-all shadow-xl hover:shadow-[#B9CF32]/20 block">
                <div className="h-40 w-full bg-[#dcd0c5] relative overflow-hidden border-b border-[#347048]/10">
                   <div className="absolute inset-0 bg-gradient-to-br from-[#EBE1D8] to-[#d6c7ba] flex items-center justify-center">
                      {club.logoUrl ? (
                        <img src={club.logoUrl} alt={club.name} className="h-24 w-24 object-contain opacity-90 mix-blend-multiply group-hover:scale-110 transition-transform" />
                      ) : (
                        <span className="text-4xl opacity-10 text-[#347048]">🎾</span>
                      )}
                   </div>
                   <div className="absolute bottom-3 right-3 bg-[#926699] px-3 py-1 rounded-full text-xs font-bold text-[#EBE1D8] shadow-sm flex items-center gap-1">
                      <span>📍</span> {club.name || 'Club'}
                   </div>
                </div>
                <div className="p-6">
                  <h3 className="text-xl font-black text-[#347048] mb-1 leading-tight">
                    {club.name}
                  </h3>
                  <p className="text-[#347048]/70 text-sm mb-5 font-medium line-clamp-1">
                     {club.address || 'Ubicación no disponible'}
                  </p>
                  <div className="w-full bg-[#347048] group-hover:bg-[#B9CF32] py-3 rounded-xl text-center transition-colors duration-300">
                     <span className="text-xs font-black text-[#D4C5B0] group-hover:text-[#347048] uppercase tracking-widest">
                        Reservar
                     </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-center py-20 bg-[#D4C5B0]/5 rounded-3xl border border-dashed border-[#D4C5B0]/20">
            <p className="text-[#D4C5B0]/60">No encontramos resultados.</p>
          </div>
        )}
      </section>

      {/* SECCIÓN B2B (DUEÑOS) */}
      <section className="bg-[#926699] relative overflow-hidden">
        <div className="container mx-auto px-4 py-24 max-w-6xl relative z-10">
          <div className="grid md:grid-cols-2 gap-16 items-center">
            
            <div>
              <span className="text-[#B9CF32] font-black tracking-wider uppercase text-xs mb-3 block">
                Software para complejos
              </span>
              <h2 className="text-4xl md:text-5xl font-black mb-6 leading-tight text-[#EBE1D8]">
                Tu club, <br/>
                <span className="opacity-70">a otro nivel.</span>
              </h2>
              <p className="text-[#EBE1D8]/80 text-lg mb-8 font-medium leading-relaxed">
                Olvidate de los mensajes de WhatsApp y las planillas de excel. Automatizá reservas, cobros y estadísticas hoy mismo.
              </p>
              
              <ul className="space-y-4 mb-10">
                <FeatureItem icon={<Calendar className="text-[#926699]" />} text="Reservas Online 24/7." />
                <FeatureItem icon={<ShieldCheck className="text-[#926699]" />} text="Adiós a los deudores." />
              </ul>

              <a href="#" className="inline-flex items-center gap-2 bg-[#B9CF32] hover:bg-[#d6ed42] text-[#347048] px-8 py-4 rounded-2xl font-black transition-all shadow-xl shadow-[#347048]/20 hover:-translate-y-1">
                Probar Demo Gratis <ArrowRight size={20} />
              </a>
            </div>

            {/* MINI DASHBOARD VENDEDOR */}
            <div className="hidden md:block relative">
                <div className="bg-[#EBE1D8] rounded-3xl p-8 shadow-2xl rotate-3 hover:rotate-0 transition-transform duration-500 border-4 border-[#EBE1D8]/20 select-none">
                    <div className="flex justify-between items-start mb-8 border-b border-[#347048]/10 pb-6">
                        <div>
                            <p className="text-[#347048]/60 text-xs font-bold uppercase tracking-wider mb-1">Ingresos de Febrero</p>
                            <h3 className="text-4xl font-black text-[#347048] tracking-tight">$ 1.250.000</h3>
                        </div>
                        <div className="bg-[#B9CF32] px-3 py-1 rounded-full flex items-center gap-1 shadow-sm">
                            <TrendingUp size={16} className="text-[#347048]" />
                            <span className="text-[#347048] font-bold text-xs">+24%</span>
                        </div>
                    </div>
                    <div className="flex items-end justify-between gap-2 h-32 mb-8 px-2">
                        <div className="w-full bg-[#347048]/10 rounded-t-lg h-[40%]"></div>
                        <div className="w-full bg-[#347048]/10 rounded-t-lg h-[60%]"></div>
                        <div className="w-full bg-[#347048]/10 rounded-t-lg h-[45%]"></div>
                        <div className="w-full bg-[#347048]/10 rounded-t-lg h-[70%]"></div>
                        <div className="w-full bg-[#347048]/10 rounded-t-lg h-[55%]"></div>
                        <div className="w-full bg-[#347048]/20 rounded-t-lg h-[80%]"></div>
                        <div className="w-full bg-gradient-to-t from-[#347048] to-[#B9CF32] rounded-t-lg h-[95%]"></div>
                    </div>
                </div>
            </div>

          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-[#D4C5B0]/10 py-10 bg-[#2a5c3b] text-center text-[#D4C5B0]/50 text-sm">
        <p className="font-medium">&copy; {new Date().getFullYear()} TuCancha App. Todos los derechos reservados.</p>
      </footer>

      {/* ------------------------------------------------------- */}
      {/* SIDEBAR DE CONTACTO (OFF-CANVAS) */}
      {/* ------------------------------------------------------- */}
      
      {/* Fondo oscuro (Backdrop) */}
      <div 
        className={`fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] transition-opacity duration-300 ${showContact ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setShowContact(false)}
      />

      {/* El Panel Lateral */}
      <div className={`fixed top-0 right-0 h-full w-full max-w-sm bg-[#EBE1D8] z-[70] shadow-2xl transform transition-transform duration-300 ease-out ${showContact ? 'translate-x-0' : 'translate-x-full'}`}>
            
            {/* Cabecera del Sidebar */}
            <div className="p-6 flex justify-between items-center border-b border-[#347048]/10">
                <h2 className="text-2xl font-black text-[#347048]">Contacto</h2>
                <button 
                    onClick={() => setShowContact(false)}
                    className="p-2 hover:bg-[#347048]/10 rounded-full text-[#347048] transition-colors"
                >
                    <X size={24} />
                </button>
            </div>

            {/* Contenido del Sidebar */}
            <div className="p-8 flex flex-col gap-6">
                <p className="text-[#347048]/80 font-medium leading-relaxed">
                    ¿Tenés dudas sobre el sistema o querés dar de alta tu club? Escribinos, respondemos al toque.
                </p>

                {/* Botones de Contacto */}
                <a href="https://wa.me/549351000000" target="_blank" rel="noreferrer" className="flex items-center gap-4 p-4 bg-white rounded-2xl shadow-sm border border-[#347048]/5 hover:border-[#B9CF32] hover:shadow-md transition-all group">
                    <div className="bg-[#B9CF32] h-12 w-12 rounded-full flex items-center justify-center text-[#347048] group-hover:scale-110 transition-transform">
                        <Phone size={20} fill="currentColor" className="text-[#347048]" />
                    </div>
                    <div>
                        <p className="text-[#347048]/50 text-xs font-bold uppercase tracking-wider">WhatsApp</p>
                        <p className="text-[#347048] font-bold text-lg">+54 9 351 ...</p>
                    </div>
                </a>

                <a href="mailto:hola@tucancha.app" className="flex items-center gap-4 p-4 bg-white rounded-2xl shadow-sm border border-[#347048]/5 hover:border-[#B9CF32] hover:shadow-md transition-all group">
                    <div className="bg-[#347048] h-12 w-12 rounded-full flex items-center justify-center text-[#EBE1D8] group-hover:scale-110 transition-transform">
                        <Mail size={20} />
                    </div>
                    <div>
                        <p className="text-[#347048]/50 text-xs font-bold uppercase tracking-wider">Email</p>
                        <p className="text-[#347048] font-bold text-lg">hola@tucancha.app</p>
                    </div>
                </a>

                {/* Redes Sociales */}
                <div className="mt-8 pt-8 border-t border-[#347048]/10">
                    <p className="text-[#347048]/60 text-sm font-bold mb-4 text-center">Seguinos en redes</p>
                    <div className="flex justify-center gap-4">
                        <a href="#" className="p-3 bg-[#347048] text-[#EBE1D8] rounded-full hover:bg-[#B9CF32] hover:text-[#347048] transition-colors">
                            <Instagram size={20} />
                        </a>
                        {/* Podés agregar más redes acá */}
                    </div>
                </div>

            </div>
      </div>

    </div>
  );
}

const FeatureItem = ({ icon, text }: any) => (
  <li className="flex items-center gap-3">
    <div className="bg-[#EBE1D8] h-8 w-8 rounded-lg flex items-center justify-center shadow-sm shrink-0 opacity-90">
        {icon}
    </div>
    <span className="text-[#EBE1D8]/90 font-bold text-lg tracking-tight">{text}</span>
  </li>
);