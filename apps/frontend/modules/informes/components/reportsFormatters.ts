export const formatReportsMoney = (value: number) =>
  `$${Number(value || 0).toLocaleString('es-AR')}`;

export const formatReportsCompactMoney = (value: number) => {
  const amount = Number(value || 0);
  if (Math.abs(amount) >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`;
  if (Math.abs(amount) >= 1000) return `$${(amount / 1000).toFixed(0)}k`;
  return formatReportsMoney(amount);
};

export const formatReportsNumber = (value: number) =>
  Number(value || 0).toLocaleString('es-AR');

export const formatReportsPercent = (value: number) =>
  `${Number(value || 0).toFixed(0)}%`;
