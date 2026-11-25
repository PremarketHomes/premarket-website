'use client';

import { Check, Copy, Link2, Lock, Mail, MessageSquare } from 'lucide-react';
import { CHANNELS, GENERAL_CHANNEL } from '../utils/campaignChannels';
import { campaignLink, displayLink } from '../utils/useShortLinks';

/**
 * Marketing Channel Performance on the campaign report: one link per channel to copy (Email / SMS / General, all the
 * same page), and how each link has performed. The figures arrive already privacy-checked from the server
 * (api/services/channelReport.js): a withheld count is never sent, so this component only lays out what it is given.
 */

const ICONS = { email: Mail, sms: MessageSquare, general: Link2 };
const SHARE = [...CHANNELS.map((c) => ({ key: c.key, label: c.label })), { key: GENERAL_CHANNEL.key, label: 'General' }];

const fmtCount = (n) => (typeof n === 'number' ? n.toLocaleString('en-AU') : '—');
const fmtRate = (n) => (typeof n === 'number' ? `${n}%` : '—');
const joinLabels = (labels) => (labels.length <= 2 ? labels.join(' and ') : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`);

function WithheldCell() {
  return (
    <span className="inline-flex items-center gap-1 text-slate-400" title="Withheld to keep buyers anonymous">
      <Lock className="w-3 h-3" aria-hidden="true" />
      <span aria-label="Withheld to keep buyers anonymous">—</span>
    </span>
  );
}

export default function ChannelPerformance({ propertyId, propNumber, channels, copy, copiedKey }) {
  const rows = channels?.rows || [];
  const min = channels?.minOpinions || 3;

  return (
    <div data-testid="channel-performance">
      <h3 className="text-lg font-bold text-slate-900 mb-3">Marketing Channel Performance</h3>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {/* Share campaign: the same page, one link per channel */}
        <div className="p-5 border-b border-slate-100">
          <p className="text-sm font-semibold text-slate-900">Share campaign</p>
          <p className="text-xs text-slate-500 mt-0.5">
            Use a different link in each channel to see which one brings in views and price opinions. All three open the same page.
          </p>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
            {SHARE.map(({ key, label }) => {
              const Icon = ICONS[key];
              const channel = key === GENERAL_CHANNEL.key ? undefined : key;
              const link = campaignLink(propertyId, propNumber, channel);
              const done = copiedKey === `${propertyId}:${key}`;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => copy(propertyId, channel)}
                  data-testid={`copy-${key}-link`}
                  title={link ? `Copy ${displayLink(link)}` : `Copy ${label} link`}
                  className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-left hover:bg-slate-50 transition-colors"
                >
                  <span className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4 text-slate-500" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-slate-800">{done ? 'Copied!' : `Copy ${label} link`}</span>
                    <span className="block text-[11px] text-slate-400 truncate" data-testid={`${key}-link-text`}>
                      {link ? displayLink(link) : 'Getting link…'}
                    </span>
                  </span>
                  {done ? <Check className="w-4 h-4 text-green-600 shrink-0" /> : <Copy className="w-4 h-4 text-slate-400 shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Performance by link */}
        {channels ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="channel-table">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500">
                  <th scope="col" className="px-5 py-2.5 text-left">Channel</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Views</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Price opinions</th>
                  <th scope="col" className="px-5 py-2.5 text-right">Conversion</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const Icon = ICONS[r.key] || Link2;
                  return (
                    <tr key={r.key} data-testid={`channel-row-${r.key}`} className="border-b border-slate-100">
                      <td className="px-5 py-3 text-slate-700">
                        <span className="inline-flex items-center gap-2"><Icon className="w-4 h-4 shrink-0 text-slate-400" />{r.label}</span>
                      </td>
                      <td className="px-3 py-3 text-right font-semibold text-slate-900 tabular-nums">{fmtCount(r.views)}</td>
                      <td className="px-3 py-3 text-right font-semibold text-slate-900 tabular-nums">{r.opinionsHidden ? <WithheldCell /> : fmtCount(r.opinions)}</td>
                      <td className="px-5 py-3 text-right text-slate-700 tabular-nums">{r.opinionsHidden ? <WithheldCell /> : fmtRate(r.conversion)}</td>
                    </tr>
                  );
                })}
                <tr data-testid="channel-row-total" className="bg-slate-50/60">
                  <td className="px-5 py-3 font-semibold text-slate-900">Total</td>
                  <td className="px-3 py-3 text-right font-bold text-slate-900 tabular-nums">{fmtCount(channels.total.views)}</td>
                  <td className="px-3 py-3 text-right font-bold text-slate-900 tabular-nums">{fmtCount(channels.total.opinions)}</td>
                  <td className="px-5 py-3 text-right font-semibold text-slate-700 tabular-nums">{fmtRate(channels.total.conversion)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-5 py-4 text-sm text-slate-500" data-testid="channel-unavailable">Channel figures are unavailable right now. Please refresh in a moment.</p>
        )}

        {/* What a withheld figure means, then how to read the table */}
        <div className="px-5 py-4 space-y-2 text-xs text-slate-500 border-t border-slate-100">
          {channels?.combined && (
            <p data-testid="channel-combined" className="flex items-start gap-1.5 text-slate-600">
              <Lock className="w-3.5 h-3.5 mt-px shrink-0 text-slate-400" />
              <span>
                <span className="font-semibold">{joinLabels(channels.combined.labels)} together: {fmtCount(channels.combined.opinions)} price opinions, {fmtRate(channels.combined.conversion)} conversion.</span>{' '}
                Shown combined because a channel with fewer than {min} opinions could single out a buyer.
              </span>
            </p>
          )}
          {channels?.withheld === 'small' && (
            <p data-testid="channel-withheld" className="flex items-start gap-1.5 text-slate-600">
              <Lock className="w-3.5 h-3.5 mt-px shrink-0 text-slate-400" />
              <span>Price opinions by channel appear once there are at least {min} in each channel (or in channels shown together), so no buyer can be singled out. Views are always shown.</span>
            </p>
          )}
          {channels?.withheld === 'inconsistent' && (
            <p data-testid="channel-withheld" className="text-slate-600">Price opinions by channel aren&apos;t available for this campaign right now. Views are shown as normal.</p>
          )}
          {channels && !channels.tracking && (
            <p data-testid="channel-not-started">
              No Email or SMS link has been opened yet, so everything so far is under General / Unknown, including all activity from before channel links.
            </p>
          )}
          <p>
            This measures the link a buyer opened, not necessarily how they first heard about the campaign: a forwarded email link counts as Email.
            General / Unknown is the general link, older links, the iPad and anything without a channel. Conversion is price opinions ÷ views.
            To keep opinions anonymous, no amounts, times or order are shown by channel.
          </p>
        </div>
      </div>
    </div>
  );
}
