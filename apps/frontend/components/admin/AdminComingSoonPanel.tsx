import AdminPanel from './ui/AdminPanel';
import AdminEmptyState from './ui/AdminEmptyState';

type AdminComingSoonPanelProps = {
  title: string;
  description: string;
};

export default function AdminComingSoonPanel({ title, description }: AdminComingSoonPanelProps) {
  return (
    <AdminPanel title={title} description="Modulo en roadmap del Admin v2." className="w-full">
      <AdminEmptyState
        title="Proximamente"
        description={description}
      />
    </AdminPanel>
  );
}
