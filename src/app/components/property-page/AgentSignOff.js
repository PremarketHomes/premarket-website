import Image from 'next/image';
import { formatDisplayPhone } from '../../utils/phone';
import PremarketBadge from './PremarketBadge';

/**
 * Elegant closing section for the redesigned property page: listing
 * agent, their agency, and a real contact option — replacing the removed
 * "nearby properties" grid and generic marketing CTA section.
 *
 * Per the product decision to stop advertising other agents' listings at
 * the bottom of a given agent's own campaign, this section intentionally
 * introduces no other property content — only this listing's own agent
 * and a subtle Premarket sign-off.
 *
 * Public presentation shows the agent's mobile number only, not their
 * email — a deliberate, presentation-only decision (their email address
 * is untouched in Firestore/Authentication; it's simply not surfaced on
 * the public page).
 */
export default function AgentSignOff({ agentData, displayLogoUrl }) {
  if (!agentData) return null;

  const fullName = [agentData.firstName, agentData.lastName].filter(Boolean).join(' ').trim();
  const phone = agentData.phone ? formatDisplayPhone(agentData.phone) : null;

  return (
    <div className="border-t border-slate-200 pt-10 sm:pt-14">
      <div className="flex flex-col sm:flex-row sm:items-center gap-6 sm:gap-8">
        <div className="flex items-center gap-4 flex-1 min-w-0">
          {agentData.avatar ? (
            <Image
              src={agentData.avatar}
              alt={fullName || 'Agent'}
              width={64}
              height={64}
              unoptimized
              className="w-16 h-16 rounded-full object-cover flex-shrink-0"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
              <svg className="w-8 h-8 text-slate-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
              </svg>
            </div>
          )}
          <div className="min-w-0">
            <p className="text-xs text-slate-400 uppercase tracking-wide font-medium mb-0.5">Presented by</p>
            <p className="font-semibold text-slate-900 text-lg truncate">{fullName || 'Your Agent'}</p>
            {agentData.companyName && (
              <p className="text-sm text-slate-500 truncate">{agentData.companyName}</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {phone && (
            <a
              href={`tel:${agentData.phone}`}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 text-slate-800 text-sm font-semibold hover:border-slate-400 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              {phone}
            </a>
          )}
          {displayLogoUrl && (
            <Image
              src={displayLogoUrl}
              alt={agentData.companyName ? `${agentData.companyName} logo` : 'Agency logo'}
              width={44}
              height={44}
              unoptimized
              className="w-11 h-11 rounded-lg object-contain border border-slate-200 bg-white"
            />
          )}
        </div>
      </div>

      <div className="mt-10 sm:mt-14 pt-6 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
        <p className="text-sm text-slate-400">A smarter way to understand the market before you sell.</p>
        <PremarketBadge variant="footer" />
      </div>
    </div>
  );
}
