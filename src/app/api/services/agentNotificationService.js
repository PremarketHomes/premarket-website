import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../../firebase/adminApp';
import { claim, finish } from './notificationService';
import { sendCampaignLinkToAgentEmail } from './agentCampaignEmail';

/**
 * Campaign-link email to the agent a campaign was created FOR. Same durable once-only machinery as every
 * other operational email (`emailLog` claim, Resend Idempotency-Key, bounded retries), with different
 * eligibility: the agent does NOT need to have activated a login, because the email carries the public
 * buyer link and needs no sign-in. The address used is the agent's login/invitation email on file
 * (`users.email`), never the editable professional contact email, so a profile edit can never redirect it.
 *
 * Event key = (property, recipient, seq). seq 1 is the initial send; an authorised "resend" is a new
 * event (seq+1), so an admin can deliberately re-send without ever risking an accidental duplicate.
 * Set DISABLE_AGENT_CAMPAIGN_EMAILS=1 to turn sending off entirely (development safety switch).
 */
export const campaignLinkKey = ({ propertyId, recipientUid, seq }) => `campaign_link__${propertyId}__${recipientUid}__${seq}`;

/** Reachable and permitted to receive mail. Invited (not yet activated) agents ARE eligible here. */
export async function checkAgentContactEligibility(uid, user) {
  if (!user) return { ok: false, reason: 'no-user-document' };
  if (!user.email) return { ok: false, reason: 'no-email' };
  if (user.accountStatus && !['active', 'invited'].includes(user.accountStatus)) return { ok: false, reason: `account-${user.accountStatus}` };
  if (user.unsubscribed === true) return { ok: false, reason: 'unsubscribed' };
  if (user.disabled === true || user.deactivated === true) return { ok: false, reason: 'account-disabled' };
  try {
    const authUser = await getAuth().getUser(uid);
    if (authUser.disabled) return { ok: false, reason: 'auth-disabled' };
  } catch (err) {
    if (err?.code === 'auth/user-not-found') return { ok: false, reason: 'no-auth-account' };
    throw err;
  }
  return { ok: true };
}

export async function sendCampaignLinkOnce({ propertyId, recipientUid, seq = 1, retryOnly = false }) {
  if (!propertyId || !recipientUid) return { sent: false, reason: 'invalid-arguments' };
  if (process.env.DISABLE_AGENT_CAMPAIGN_EMAILS === '1') return { sent: false, reason: 'disabled' };

  const key = campaignLinkKey({ propertyId, recipientUid, seq });
  const logRef = adminDb.collection('emailLog').doc(key);
  const claimed = await claim(logRef, { type: 'campaign_link', propertyId, recipientUid, seq, createdAt: FieldValue.serverTimestamp() }, { retryOnly });
  if (!claimed.proceed) return { sent: false, reason: claimed.reason };

  try {
    const [propertySnap, userSnap] = await Promise.all([
      adminDb.collection('properties').doc(propertyId).get(),
      adminDb.collection('users').doc(recipientUid).get(),
    ]);
    if (!propertySnap.exists) return await finish(logRef, 'skipped', 'property-missing');
    const property = propertySnap.data();
    // Stale event: the campaign belongs to someone else now, or was archived.
    if (property.userId !== recipientUid) return await finish(logRef, 'skipped', 'no-longer-owner');
    if (property.archived === true || property.hidden === true) return await finish(logRef, 'skipped', 'campaign-archived');

    const user = userSnap.exists ? userSnap.data() : null;
    const eligibility = await checkAgentContactEligibility(recipientUid, user);
    if (!eligibility.ok) return await finish(logRef, 'skipped', eligibility.reason);

    let createdByName = null;
    if (property.createdByUid && property.createdByUid !== recipientUid) {
      const c = await adminDb.collection('users').doc(property.createdByUid).get();
      if (c.exists) createdByName = `${c.data().firstName || ''} ${c.data().lastName || ''}`.trim() || null;
    }

    await sendCampaignLinkToAgentEmail({
      to: user.email, firstName: user.firstName,
      propertyAddress: property.formattedAddress || property.address || 'your property',
      propertyId, createdByName, resend: seq > 1, idempotencyKey: key,
    });
    await logRef.update({ status: 'sent', sentAt: FieldValue.serverTimestamp() });
    return { sent: true };
  } catch (err) {
    console.error(`campaign-link notification failed (${key}):`, err);
    const message = String(err?.message || err);
    const uncertain = !/^Resend rejected the email/.test(message);
    try { await logRef.update({ status: 'failed', uncertain, lastError: message.slice(0, 300) }); } catch (logErr) { console.error(`could not record failure for ${key}:`, logErr); }
    return { sent: false, reason: 'send-failed' };
  }
}
