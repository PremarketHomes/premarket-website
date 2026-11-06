import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

/** One clear way back to the dashboard from every Office Workspace page (44px tap target for phone/iPad). */
export default function BackToDashboard({ className = '' }) {
  return (
    <Link href="/dashboard" className={`inline-flex items-center gap-2 min-h-[44px] px-4 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-900 ${className}`}>
      <ArrowLeft className="w-4 h-4" /> Back to Dashboard
    </Link>
  );
}
