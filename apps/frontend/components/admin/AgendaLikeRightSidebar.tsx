// ---------------------------------------------------------------------------
// DEPRECACIÓN SUAVE — prefer AdminDrawer for new features
// ---------------------------------------------------------------------------
// AgendaLikeRightSidebar es un wrapper fino de AdminSidebarScaffold.
// Para features nuevas, usar AdminDrawer (components/admin/ui/AdminDrawer.tsx):
//   - Soporta tamaños sm/md/lg
//   - Pantalla completa en mobile (inset-0)
//   - Nomenclatura correcta: Drawer = panel operativo, Sidebar = navegación principal
//
// Este componente se mantiene para compatibilidad con agenda-playground2.tsx
// y pagos-playground.tsx. No migrar hasta que esos archivos se refactoricen.
// ---------------------------------------------------------------------------
import type { ReactNode } from 'react';
import AdminSidebarScaffold from './ui/AdminSidebarScaffold';

type AgendaLikeRightSidebarProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  statusChip?: ReactNode;
  statusChipClassName?: string;
  tabs?: Array<{ id: string; label: string }>;
  activeTabId?: string;
  onTabChange?: (id: string) => void;
  children: ReactNode;
  footer?: ReactNode;
  maxWidthClassName?: string;
  frameContent?: boolean;
  contentClassName?: string;
  framedContentClassName?: string;
};

export default function AgendaLikeRightSidebar({
  open,
  onClose,
  title,
  subtitle,
  statusChip,
  statusChipClassName = '',
  tabs,
  activeTabId,
  onTabChange,
  children,
  footer,
  maxWidthClassName = 'max-w-[620px]',
  frameContent = true,
  contentClassName,
  framedContentClassName,
}: AgendaLikeRightSidebarProps) {
  return (
    <AdminSidebarScaffold
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      statusChip={statusChip}
      statusChipClassName={statusChipClassName}
      widthClassName={`w-full ${maxWidthClassName}`}
      tabs={tabs}
      activeTabId={activeTabId}
      onTabChange={onTabChange}
      footer={footer}
      zIndexClassName="z-[2147483150]"
      frameContent={frameContent}
      contentClassName={contentClassName}
      framedContentClassName={framedContentClassName}
    >
      {children}
    </AdminSidebarScaffold>
  );
}
