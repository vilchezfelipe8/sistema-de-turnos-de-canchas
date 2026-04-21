import type {
  RefundExecutionMethod,
  RefundReasonType,
  RefundRecord,
  RefundStatus
} from '../../services/PaymentService';

export type { RefundExecutionMethod, RefundReasonType, RefundRecord, RefundStatus };

export type RefundContext = 'ACCOUNT_MANUAL' | 'BOOKING_CANCELLATION';

export type RefundDraft = {
  amountInput: string;
  executeNow: boolean;
  reasonType: RefundReasonType;
  executionNotes: string;
};

export type RefundActionHandlers = {
  onApprove?: (executeNow: boolean) => void;
  onExecute?: () => void;
  onRetry?: (executeNow: boolean) => void;
  onFail?: () => void;
  onCancel?: () => void;
};
