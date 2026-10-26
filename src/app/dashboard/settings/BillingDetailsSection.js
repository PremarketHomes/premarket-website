'use client';

import { useState, useEffect, useCallback } from 'react';
import { Receipt, Clock, CheckCircle2, XCircle, Pencil, Save, Loader2 } from 'lucide-react';
import { authFetch } from '../../utils/authFetch';

/**
 * Account Settings "Billing Details" — the agent-facing view/edit of
 * their OWN billingContacts/agent:{uid} record. Reuses the exact same
 * endpoints as the existing dashboard banner and signup form
 * (GET /api/agency/billing-contact-status, POST
 * /api/agency/propose-billing-contact) and the exact same
 * billingService.js propose/approve/reject lifecycle — this is a new
 * SURFACE for that one existing system, not a new billing mechanism.
 *
 * Two distinct review flows, both handled by the one "Edit Billing
 * Details" form below:
 *
 *   - Never confirmed yet (status unset/pending/rejected) — submitting
 *     is the existing INITIAL confirmation workflow (see
 *     billingService.proposeBillingContact's first branch); the form
 *     IS the current state, since there's no separately-active
 *     contact yet to protect.
 *
 *   - Already confirmed — submitting files an AMENDMENT (changeRequest)
 *     for superAdmin review. The confirmed values shown here stay
 *     exactly as they are — still fully valid for every charge and
 *     invoice send — until that specific change is approved; if it's
 *     rejected instead, the confirmed values are simply never touched
 *     and the agent can submit another change. Historical invoices
 *     are never affected either way — this only ever changes who
 *     FUTURE invoices go to.
 */
const EMPTY_ADDRESS = { line1: '', suburb: '', state: '', postcode: '' };
const AU_STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'];
const formatAddress = (a) => (a?.line1 ? `${a.line1}, ${a.suburb} ${a.state} ${a.postcode}` : '');
const INPUT_CLASS =
  'w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-base sm:text-sm text-slate-900 bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400 transition-all';

export default function BillingDetailsSection() {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('unset');
  const [billingName, setBillingName] = useState(null);
  const [contactName, setContactName] = useState(null);
  const [contactEmail, setContactEmail] = useState(null);
  const [proposedBillingName, setProposedBillingName] = useState(null);
  const [proposedName, setProposedName] = useState(null);
  const [proposedEmail, setProposedEmail] = useState(null);
  const [rejectionReason, setRejectionReason] = useState(null);
  const [changeRequest, setChangeRequest] = useState(null);
  const [officeBillingName, setOfficeBillingName] = useState(null);
  const [underReview, setUnderReview] = useState(false);
  // Office administrators bill on behalf of their office: the same endpoints
  // and approval flow, with a business-oriented form (legal name, ABN, address).
  const [isOffice, setIsOffice] = useState(false);
  const [entityName, setEntityName] = useState('');
  const [abn, setAbn] = useState(null);
  const [address, setAddress] = useState(null);
  const [proposedAbn, setProposedAbn] = useState(null);
  const [proposedAddress, setProposedAddress] = useState(null);

  const [editing, setEditing] = useState(false);
  const [formBillingName, setFormBillingName] = useState('');
  const [formContactName, setFormContactName] = useState('');
  const [formContactEmail, setFormContactEmail] = useState('');
  const [formAbn, setFormAbn] = useState('');
  const [formAddress, setFormAddress] = useState(EMPTY_ADDRESS);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [justSubmitted, setJustSubmitted] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await authFetch('/api/agency/billing-contact-status');
      const data = await res.json();
      // Office members are billed through their office, not individually.
      setUnderReview(!!data.billingReview);
      setOfficeBillingName(data.officeBilling ? (data.billingEntityName || 'your office') : null);
      setIsOffice(data.billingEntityType === 'office');
      setEntityName(data.billingEntityName || '');
      setAbn(data.abn ?? null);
      setAddress(data.address ?? null);
      setProposedAbn(data.proposedAbn ?? null);
      setProposedAddress(data.proposedAddress ?? null);
      setStatus(data.status || 'unset');
      setBillingName(data.billingName ?? null);
      setContactName(data.name ?? null);
      setContactEmail(data.email ?? null);
      setProposedBillingName(data.proposedBillingName ?? null);
      setProposedName(data.proposedName ?? null);
      setProposedEmail(data.proposedEmail ?? null);
      setRejectionReason(data.rejectionReason ?? null);
      setChangeRequest(data.changeRequest ?? null);
    } catch (err) {
      console.error('Failed to load billing details:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  function startEdit() {
    setSubmitError('');
    // Pre-fill from whichever submission is most relevant to correct
    // right now: a still-pending/rejected amendment on an already
    // confirmed contact, else the confirmed contact itself, else the
    // last initial submission, else blank.
    if (status === 'confirmed' && changeRequest) {
      setFormBillingName(changeRequest.proposedBillingName || '');
      setFormContactName(changeRequest.proposedName || '');
      setFormContactEmail(changeRequest.proposedEmail || '');
      setFormAbn(changeRequest.proposedAbn || '');
      setFormAddress(changeRequest.proposedAddress || EMPTY_ADDRESS);
    } else if (status === 'confirmed') {
      setFormBillingName(billingName || '');
      setFormContactName(contactName || '');
      setFormContactEmail(contactEmail || '');
      setFormAbn(abn || '');
      setFormAddress(address || EMPTY_ADDRESS);
    } else {
      setFormBillingName(proposedBillingName || '');
      setFormContactName(proposedName || '');
      setFormContactEmail(proposedEmail || '');
      setFormAbn(proposedAbn || '');
      setFormAddress(proposedAddress || EMPTY_ADDRESS);
    }
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setSubmitError('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!formContactEmail.trim()) {
      setSubmitError('A billing email address is required');
      return;
    }
    if (isOffice && !formBillingName.trim()) {
      setSubmitError('The legal business / billing entity name is required');
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    try {
      const res = await authFetch('/api/agency/propose-billing-contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          billingName: formBillingName.trim(),
          contactName: formContactName.trim(),
          contactEmail: formContactEmail.trim(),
          // Independent agents' form is unchanged: ABN/address are office-only.
          ...(isOffice && { abn: formAbn.trim(), address: formAddress }),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to submit billing details');
      setEditing(false);
      setJustSubmitted(true);
      setTimeout(() => setJustSubmitted(false), 4000);
      await fetchStatus();
    } catch (err) {
      console.error('Submit billing details error:', err);
      setSubmitError(err.message || 'Failed to submit billing details');
    } finally {
      setSubmitting(false);
    }
  }

  if (!loading && underReview) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center gap-2 mb-1">
          <Receipt className="w-4 h-4 text-orange-600" />
          <h2 className="text-sm font-semibold text-slate-900">Billing Details</h2>
        </div>
        <p className="text-sm text-slate-600">
          Your billing setup is being reviewed by Premarket. Nothing is needed from you right now.
        </p>
      </div>
    );
  }

  if (!loading && officeBillingName) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center gap-2 mb-1">
          <Receipt className="w-4 h-4 text-orange-600" />
          <h2 className="text-sm font-semibold text-slate-900">Billing Details</h2>
        </div>
        <p className="text-sm text-slate-600">
          Premarket campaigns are billed to {officeBillingName}, not to you personally. Your office
          administrator manages the billing details.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center gap-2 mb-1">
          <Receipt className="w-4 h-4 text-orange-600" />
          <h2 className="text-sm font-semibold text-slate-900">Billing Details</h2>
        </div>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 text-slate-300 animate-spin" />
        </div>
      </div>
    );
  }

  const hasPendingChange = status === 'confirmed' && changeRequest?.status === 'pending';
  const hasRejectedChange = status === 'confirmed' && changeRequest?.status === 'rejected';

  const StatusBadge = () => {
    if (status === 'confirmed' && !hasPendingChange) {
      return (
        <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 text-[11px] font-semibold px-2 py-1 rounded-full">
          <CheckCircle2 className="w-3 h-3" /> {isOffice ? 'Approved' : 'Verified'}
        </span>
      );
    }
    if (status === 'confirmed' && hasPendingChange) {
      return (
        <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 text-[11px] font-semibold px-2 py-1 rounded-full">
          <Clock className="w-3 h-3" /> {isOffice ? 'Approved' : 'Verified'} — change pending
        </span>
      );
    }
    if (status === 'pending') {
      return (
        <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 text-[11px] font-semibold px-2 py-1 rounded-full">
          <Clock className="w-3 h-3" /> {isOffice ? 'Pending approval' : 'Pending review'}
        </span>
      );
    }
    if (status === 'rejected') {
      return (
        <span className="inline-flex items-center gap-1 bg-red-50 text-red-700 text-[11px] font-semibold px-2 py-1 rounded-full">
          <XCircle className="w-3 h-3" /> Rejected
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-600 text-[11px] font-semibold px-2 py-1 rounded-full">
        Not submitted
      </span>
    );
  };

  // Display values when NOT editing — the agent's currently-ACTIVE
  // confirmed contact takes priority (satisfies "keep the previously
  // approved billing contact active while changes are pending"); only
  // falls back to the last-submitted proposed* values when nothing
  // has ever been confirmed.
  const displayBillingName = status === 'confirmed' ? billingName : proposedBillingName;
  const displayContactName = status === 'confirmed' ? contactName : proposedName;
  const displayContactEmail = status === 'confirmed' ? contactEmail : proposedEmail;
  const displayAbn = status === 'confirmed' ? abn : proposedAbn;
  const displayAddress = status === 'confirmed' ? address : proposedAddress;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Receipt className="w-4 h-4 text-orange-600" />
          <h2 className="text-sm font-semibold text-slate-900">Billing Details</h2>
        </div>
        <StatusBadge />
      </div>
      <p className="text-xs text-slate-500 mb-4">
        {isOffice
          ? `Premarket invoices for all of ${entityName || 'your office'}'s campaigns are issued to these details as one consolidated invoice. Submitting them sends them to Premarket for approval; no invoice is created until they're approved.`
          : 'Premarket invoices are issued to you individually. These details — not necessarily your login email — are used as your billing contact.'}
      </p>

      {status === 'pending' && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
          {isOffice ? 'Awaiting Premarket\'s approval. No invoice is created until your details are approved.' : 'Awaiting Premarket\'s review.'}
        </p>
      )}
      {status === 'rejected' && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
          Your submission needs changes{rejectionReason ? `: ${rejectionReason}` : '.'} Please resubmit below.
        </p>
      )}
      {hasPendingChange && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
          A change is awaiting Premarket&apos;s review — your current, verified details below remain active until it&apos;s approved:
          <br />
          <span className="font-medium">{changeRequest.proposedBillingName || '—'} · {changeRequest.proposedName || '—'} · {changeRequest.proposedEmail}{changeRequest.proposedAbn ? ` · ABN ${changeRequest.proposedAbn}` : ''}</span>
        </p>
      )}
      {hasRejectedChange && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
          Your last change request was rejected{changeRequest.rejectionReason ? `: ${changeRequest.rejectionReason}` : '.'} Your current verified details below are unaffected — you can submit another change.
        </p>
      )}
      {justSubmitted && (
        <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-4 flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5" /> Submitted for Premarket&apos;s review.
        </p>
      )}

      {!editing && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div>
              <p className="text-xs font-semibold text-slate-600 mb-1">{isOffice ? 'Legal business / billing entity name' : 'Agency Name'}</p>
              <p className="text-sm text-slate-900">{displayBillingName || <span className="text-slate-400">Not provided</span>}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-600 mb-1">Accounts Contact Name</p>
              <p className="text-sm text-slate-900">{displayContactName || <span className="text-slate-400">Not provided</span>}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-600 mb-1">{isOffice ? 'Accounts email' : 'Billing Email'}</p>
              <p className="text-sm text-slate-900 break-words">{displayContactEmail || <span className="text-slate-400">Not provided</span>}</p>
            </div>
          </div>
          {isOffice && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <div>
                <p className="text-xs font-semibold text-slate-600 mb-1">ABN</p>
                <p className="text-sm text-slate-900">{displayAbn || <span className="text-slate-400">Not provided</span>}</p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-xs font-semibold text-slate-600 mb-1">Billing address</p>
                <p className="text-sm text-slate-900">{formatAddress(displayAddress) || <span className="text-slate-400">Not provided</span>}</p>
              </div>
            </div>
          )}
          <button
            onClick={startEdit}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 transition-all"
          >
            <Pencil className="w-4 h-4" />
            Edit Billing Details
          </button>
        </>
      )}

      {editing && (
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">{isOffice ? 'Legal business / billing entity name' : 'Agency Name'}</label>
              <input
                type="text"
                value={formBillingName}
                onChange={(e) => setFormBillingName(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-900 bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400 transition-all"
                required={isOffice}
                placeholder={isOffice ? 'The name invoices should be issued to' : 'e.g. Ray White, LJ Hooker'}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Accounts Contact Name</label>
              <input
                type="text"
                value={formContactName}
                onChange={(e) => setFormContactName(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-900 bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400 transition-all"
                placeholder="Who should we address invoices to?"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">{isOffice ? 'Accounts email address' : 'Billing Email'}</label>
            <input
              type="email"
              required
              value={formContactEmail}
              onChange={(e) => setFormContactEmail(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-900 bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400 transition-all"
              placeholder={isOffice ? 'Where invoices should be sent' : 'This can be different from your login email'}
            />
          </div>
          {isOffice && (
            <>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">ABN (optional)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={formAbn}
                  onChange={(e) => setFormAbn(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-base sm:text-sm text-slate-900 bg-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400 transition-all"
                  placeholder="11 digits, e.g. 12 345 678 901"
                />
              </div>
              <div className="space-y-3">
                <label className="block text-xs font-semibold text-slate-600">Billing address (optional)</label>
                <input
                  type="text"
                  value={formAddress.line1}
                  onChange={(e) => setFormAddress((a) => ({ ...a, line1: e.target.value }))}
                  className={INPUT_CLASS}
                  placeholder="Street address"
                  autoComplete="address-line1"
                />
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <input
                    type="text"
                    value={formAddress.suburb}
                    onChange={(e) => setFormAddress((a) => ({ ...a, suburb: e.target.value }))}
                    className={`${INPUT_CLASS} col-span-2`}
                    placeholder="Suburb"
                    autoComplete="address-level2"
                  />
                  <select
                    value={formAddress.state}
                    onChange={(e) => setFormAddress((a) => ({ ...a, state: e.target.value }))}
                    className={INPUT_CLASS}
                    aria-label="State or territory"
                  >
                    <option value="">State</option>
                    {AU_STATES.map((st) => <option key={st} value={st}>{st}</option>)}
                  </select>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    value={formAddress.postcode}
                    onChange={(e) => setFormAddress((a) => ({ ...a, postcode: e.target.value }))}
                    className={INPUT_CLASS}
                    placeholder="Postcode"
                    autoComplete="postal-code"
                  />
                </div>
              </div>
            </>
          )}

          {submitError && <p className="text-xs text-red-600">{submitError}</p>}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-[#e48900] to-[#c64500] text-white shadow-lg shadow-orange-500/30 hover:shadow-orange-500/50 transition-all disabled:opacity-70"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  {status === 'confirmed' ? 'Submit Change for Review' : 'Submit for Review'}
                </>
              )}
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              disabled={submitting}
              className="px-4 py-2.5 text-slate-500 rounded-xl text-sm font-medium hover:bg-slate-100 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
