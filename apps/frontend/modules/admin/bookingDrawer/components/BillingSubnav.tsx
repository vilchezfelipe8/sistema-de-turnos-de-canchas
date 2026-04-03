import type { BillingTab } from '../reducer';

type Props = {
  active: BillingTab;
  onChange: (tab: BillingTab) => void;
};

const options: Array<{ value: BillingTab; label: string }> = [
  { value: 'SUMMARY', label: 'Resumen' },
  { value: 'ASSIGNMENTS', label: 'Asignacion' },
  { value: 'PAYMENTS', label: 'Pagos' },
];

export default function BillingSubnav({ active, onChange }: Props) {
  return (
    <div className="mt-3 grid grid-cols-3 rounded-xl border border-[#dce2ee] bg-[#f7f8fc] p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`h-8 rounded-lg text-[12px] font-semibold transition ${
            active === option.value
              ? 'bg-white border border-[#d8dff0] text-[#2e58e5] shadow-[0_1px_2px_rgba(20,31,61,0.06)]'
              : 'text-[#616b81] hover:text-[#2d3650]'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

