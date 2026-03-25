interface RouteTransitionScreenProps {
  message?: string;
}

export default function RouteTransitionScreen({
  message = 'Redirigiendo...'
}: RouteTransitionScreenProps) {
  return (
    <main className="min-h-screen relative overflow-hidden flex flex-col items-center justify-center p-4 bg-vibrant-brand text-[#D4C5B0]">
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none opacity-25">
        <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-[#B9CF32] blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[500px] h-[500px] rounded-full bg-[#926699] blur-[150px]" />
      </div>
      <div className="relative z-10 flex flex-col items-center gap-4">
        <div className="h-10 w-10 rounded-full border-2 border-[#B9CF32]/30 border-t-[#B9CF32] animate-spin" />
        <p className="text-sm font-bold tracking-wide text-[#D4C5B0]/90">{message}</p>
      </div>
    </main>
  );
}
