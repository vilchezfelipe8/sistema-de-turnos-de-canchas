import type { BillingTab } from '../reducer';

type Props = {
  active: BillingTab;
  onChange: (tab: BillingTab) => void;
};

const options: Array<{ value: BillingTab; label: string }> = [
  { value: 'SUMMARY', label: 'Resumen' },
  { value: 'ASSIGNMENTS', label: 'Asignación' },
  { value: 'PAYMENTS', label: 'Pagos' },
];

export default function BillingSubnav({ active, onChange }: Props) {
  return (
    <div className="mt-3 grid grid-cols-3 rounded-xl border border-p-border bg-p-surface-2 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`h-8 rounded-lg text-[12px] font-semibold transition ${
            active === option.value
              ? 'bg-p-surface border border-p-accent text-p-accent shadow-p-card'
              : 'text-p-text-secondary hover:text-p-text-secondary'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

