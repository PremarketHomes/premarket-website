'use client';

const STATUS_STYLES = {
  paid: 'bg-emerald-100 text-emerald-700',
  sent: 'bg-amber-100 text-amber-700',
  authorised: 'bg-amber-100 text-amber-700',
  PAID: 'bg-emerald-100 text-emerald-700',
  SENT: 'bg-amber-100 text-amber-700',
  AUTHORISED: 'bg-amber-100 text-amber-700',
  draft: 'bg-slate-100 text-slate-600',
  approved: 'bg-blue-100 text-blue-700',
  sending: 'bg-yellow-100 text-yellow-700',
  partial: 'bg-orange-100 text-orange-700',
  failed: 'bg-red-100 text-red-700',
  error: 'bg-red-100 text-red-700',
  cancelled: 'bg-slate-100 text-slate-400',
  voided: 'bg-slate-100 text-slate-400',
  VOIDED: 'bg-slate-100 text-slate-400',
  OVERDUE: 'bg-red-100 text-red-700',
  pending: 'bg-slate-100 text-slate-500',
  queued: 'bg-blue-100 text-blue-700',
  invoiced: 'bg-emerald-100 text-emerald-700',
  excluded: 'bg-slate-100 text-slate-400',
  reversed: 'bg-red-100 text-red-700',
  invoice_created: 'bg-amber-100 text-amber-700',
  email_failed: 'bg-red-100 text-red-700',
};

export default function InvoiceStatusBadge({ status }) {
  const style = STATUS_STYLES[status] || 'bg-slate-100 text-slate-500';
  const label = (status || 'unknown').toUpperCase();

  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold rounded-full ${style}`}>
      {label}
    </span>
  );
}
