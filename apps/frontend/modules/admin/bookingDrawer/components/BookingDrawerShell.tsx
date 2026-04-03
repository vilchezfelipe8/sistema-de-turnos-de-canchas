import type { BookingDrawerDraft, ChargeMode } from '../types';
import FinancialSummaryCard from './FinancialSummaryCard';
import BillingSubnav from './BillingSubnav';
import ChargeAssignmentSection from './ChargeAssignmentSection';
import PaymentsSection from './PaymentsSection';
import type { BillingTab } from '../reducer';

type Props = {
  draft: BookingDrawerDraft | null;
  activeTab: BillingTab;
  warnings?: string[];
  paymentsLocked?: boolean;
  paymentsLockedReason?: string;
  onTabChange: (tab: BillingTab) => void;
  onModeChange: (mode: ChargeMode) => void;
  onResponsibleChange: (participantId: string) => void;
  onAssignmentAmountChange: (assignmentId: string, amount: number) => void;
  onToggleChargeable: (assignmentId: string, isChargeable: boolean) => void;
  onQueuePayment: (input: {
    amount: number;
    method: 'CASH' | 'TRANSFER' | 'CARD' | 'OTHER';
    assignmentId?: string;
    note?: string;
  }) => void;
  onRemoveQueuedPayment: (clientTempId: string) => void;
  onRegisterPayment?: () => void;
  onCollectRemaining?: () => void;
};

export default function BookingDrawerShell({
  draft,
  activeTab,
  warnings = [],
  paymentsLocked = false,
  paymentsLockedReason,
  onTabChange,
  onModeChange,
  onResponsibleChange,
  onAssignmentAmountChange,
  onToggleChargeable,
  onQueuePayment,
  onRemoveQueuedPayment,
  onRegisterPayment,
  onCollectRemaining,
}: Props) {
  if (!draft) return null;

  const chargeResponsible = draft.participants.find(
    (participant) => participant.id === draft.billing.chargeResponsibleParticipantId
  );

  return (
    <div className="space-y-3">
      <FinancialSummaryCard
        summary={draft.billing.financialSummary}
        chargeMode={draft.billing.chargeMode}
        chargeResponsibleName={chargeResponsible?.displayName}
        warnings={warnings}
        onRegisterPayment={onRegisterPayment}
        onCollectRemaining={onCollectRemaining}
      />

      <BillingSubnav active={activeTab} onChange={onTabChange} />

      {activeTab === 'SUMMARY' && (
        <div className="rounded-xl border border-[#dce2ee] bg-white p-3">
          <p className="text-[13px] font-semibold text-[#2f364b]">Como usar este bloque</p>
          <ul className="mt-2 space-y-1 text-[12px] text-[#68728a]">
            <li>1. Revisa el resumen para ver total, pagado y saldo.</li>
            <li>2. Define asignacion de cobro en la pestana Asignacion.</li>
            <li>3. Registra pagos en la pestana Pagos y guarda cambios.</li>
          </ul>
        </div>
      )}

      {activeTab === 'ASSIGNMENTS' && (
        <ChargeAssignmentSection
          mode={draft.billing.chargeMode}
          participants={draft.participants}
          assignments={draft.billing.assignments}
          totalAmount={draft.billing.financialSummary.totalAmount}
          chargeResponsibleParticipantId={draft.billing.chargeResponsibleParticipantId}
          onModeChange={onModeChange}
          onResponsibleChange={onResponsibleChange}
          onAssignmentAmountChange={onAssignmentAmountChange}
          onToggleChargeable={onToggleChargeable}
        />
      )}

      {activeTab === 'PAYMENTS' && (
        <PaymentsSection
          payments={draft.billing.payments}
          assignments={draft.billing.assignments}
          participants={draft.participants}
          chargeMode={draft.billing.chargeMode}
          pendingQueue={draft.billing.pendingPaymentsQueue}
          remainingAmount={draft.billing.financialSummary.remainingAmount}
          paymentsLocked={paymentsLocked}
          paymentsLockedReason={paymentsLockedReason}
          onQueuePayment={onQueuePayment}
          onRemoveQueuedPayment={onRemoveQueuedPayment}
        />
      )}
    </div>
  );
}
