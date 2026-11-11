import { fetchWithAuth } from '../utils/apiClient';
import { getApiUrl } from '../utils/apiUrl';
import { throwApiErrorFromResponse } from '../utils/apiError';

const apiBase = () => `${getApiUrl()}/api`;

export type SubscriptionBillingType = 'RECURRING' | 'FIXED_TERM';
export type SubscriptionEntitlementKind = 'ACTIVITY_ACCESS' | 'CLASS_CREDITS';
export type SubscriptionStatus = 'ACTIVE' | 'PAUSED' | 'PAST_DUE' | 'EXPIRED' | 'CANCELLED';
export type SubscriptionInstallmentStatus = 'PENDING' | 'PAID' | 'VOID';

export type SubscriptionPlanOption = {
  id: string;
  label: string;
  installmentsCount: number;
  installmentPrice: number;
  totalListPrice: number;
  isActive: boolean;
  sortOrder: number;
};

export type SubscriptionPlanEntitlement = {
  id: string;
  kind: SubscriptionEntitlementKind;
  activityType: { id: number; name: string };
  timesPerWeek: number | null;
  creditsPerPeriod: number | null;
  classType: 'INDIVIDUAL' | 'GROUP' | null;
};

export type SubscriptionPlan = {
  id: string;
  name: string;
  description: string | null;
  billingType: SubscriptionBillingType;
  periodMonths: number;
  enrollmentFee: number | null;
  dueDayOfMonth: number | null;
  graceDays: number;
  pauseMaxDays: number;
  pauseMaxCount: number;
  grantsMemberCategory: { id: string; name: string } | null;
  isActive: boolean;
  sortOrder: number;
  subscriptionsCount: number;
  options: SubscriptionPlanOption[];
  entitlements: SubscriptionPlanEntitlement[];
};

export type SubscriptionPlanInput = {
  name: string;
  description?: string | null;
  billingType: SubscriptionBillingType;
  periodMonths: number;
  enrollmentFee?: number | null;
  dueDayOfMonth?: number | null;
  graceDays?: number;
  pauseMaxDays?: number;
  pauseMaxCount?: number;
  grantsMemberCategoryId?: string | null;
  options: Array<{ id?: string | null; label: string; installmentsCount: number; installmentPrice: number; isActive?: boolean }>;
  entitlements?: Array<{
    kind: SubscriptionEntitlementKind;
    activityTypeId: number;
    timesPerWeek?: number | null;
    creditsPerPeriod?: number | null;
    classType?: 'INDIVIDUAL' | 'GROUP' | null;
  }>;
};

export type SubscriptionInstallment = {
  id: string;
  sequence: number;
  kind: 'ENROLLMENT_FEE' | 'PERIOD';
  coversFrom: string;
  coversTo: string;
  dueDate: string;
  listAmount: number;
  status: SubscriptionInstallmentStatus;
  isOverdue: boolean;
  paidAt: string | null;
  account: {
    id: string;
    displayCode: string | null;
    status: 'OPEN' | 'CLOSED';
    totalAmount: number;
    paidAmount: number;
    remainingAmount: number;
  } | null;
};

export type ClientSubscription = {
  id: string;
  planId: string;
  optionId: string;
  planName: string;
  optionLabel: string;
  billingType: SubscriptionBillingType | null;
  status: SubscriptionStatus;
  client: { id: string; name: string };
  payerClient: { id: string; name: string };
  startDate: string;
  endDate: string | null;
  currentPeriodEnd: string;
  paidThrough: string | null;
  hasOverdue: boolean;
  pendingAmount: number;
  autoRenew: boolean;
  pausesUsed: number;
  priceLocked: boolean;
  cancelledAt: string | null;
  cancelReason: string | null;
  notes: string | null;
  createdAt: string;
  installments: SubscriptionInstallment[];
};

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  ACTIVE: 'Activo',
  PAUSED: 'En pausa',
  PAST_DUE: 'En mora',
  EXPIRED: 'Vencido',
  CANCELLED: 'Cancelado',
};

export const BILLING_TYPE_LABELS: Record<SubscriptionBillingType, string> = {
  RECURRING: 'Se renueva solo',
  FIXED_TERM: 'Plazo fijo',
};

const request = async <T>(path: string, init: RequestInit, fallback: string): Promise<T> => {
  const res = await fetchWithAuth(`${apiBase()}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (!res.ok) await throwApiErrorFromResponse(res, fallback);
  return res.json();
};

export const SubscriptionAdminService = {
  listPlans: (slug: string, includeInactive = false) =>
    request<SubscriptionPlan[]>(
      `/clubs/${slug}/admin/subscription-plans${includeInactive ? '?includeInactive=1' : ''}`,
      { method: 'GET' },
      'No se pudieron cargar los planes.'
    ),

  createPlan: (slug: string, body: SubscriptionPlanInput) =>
    request<SubscriptionPlan>(`/clubs/${slug}/admin/subscription-plans`, { method: 'POST', body: JSON.stringify(body) }, 'No se pudo crear el plan.'),

  updatePlan: (slug: string, planId: string, body: SubscriptionPlanInput) =>
    request<SubscriptionPlan>(
      `/clubs/${slug}/admin/subscription-plans/${planId}`,
      { method: 'PUT', body: JSON.stringify(body) },
      'No se pudo guardar el plan.'
    ),

  setPlanActive: (slug: string, planId: string, isActive: boolean) =>
    request<SubscriptionPlan>(
      `/clubs/${slug}/admin/subscription-plans/${planId}/status`,
      { method: 'PATCH', body: JSON.stringify({ isActive }) },
      'No se pudo cambiar el estado del plan.'
    ),

  listByClient: (slug: string, clientId: string) =>
    request<ClientSubscription[]>(
      `/clubs/${slug}/admin/subscriptions?clientId=${encodeURIComponent(clientId)}`,
      { method: 'GET' },
      'No se pudieron cargar los planes del cliente.'
    ),

  sell: (
    slug: string,
    body: { clientId: string; payerClientId?: string | null; planId: string; optionId: string; startDate?: string | null; notes?: string | null }
  ) =>
    request<ClientSubscription>(`/clubs/${slug}/admin/subscriptions`, { method: 'POST', body: JSON.stringify(body) }, 'No se pudo vender el plan.'),

  cancel: (slug: string, subscriptionId: string, reason?: string | null) =>
    request<ClientSubscription>(
      `/clubs/${slug}/admin/subscriptions/${subscriptionId}/cancel`,
      { method: 'POST', body: JSON.stringify({ reason: reason || null }) },
      'No se pudo cancelar el plan.'
    ),
};
