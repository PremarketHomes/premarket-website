import { buildRegistrationPath } from '../../utils/registrationLink';
import { Resend } from 'resend';
import { wrapEmail, ctaButton, ctaButtonDark, infoBox, greeting, p, signature, eyebrow, heading, lead, divider, detailList, steps, esc, toPlainText, COLORS, BASE_URL } from './emailTemplates';

const FROM_EMAIL = 'Premarket <no-reply@mail.premarket.homes>';

let _resend;
function getResend() {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

// The Resend SDK never rejects/throws for an API-level failure (an
// invalid key, a bad "from" domain, a rate limit, a suppressed
// recipient, etc.) — it always resolves, with `{ data: null, error }`
// on failure rather than a thrown exception. Every caller of sendEmail
// across this file does `await sendEmail(...)` inside its own
// try/catch expecting a throw on failure; without this check, a
// Resend-reported error was silently swallowed as if the email had
// sent — which is exactly what happened in production: the stored
// RESEND_API_KEY was invalid, every send "succeeded" with no error
// anywhere, and no email ever actually left Resend's side.
export async function sendEmail({ to, subject, html, text, attachments, idempotencyKey }) {
  // Every email carries a plain-text part; templates may pass their own.
  const textPart = text || (html ? toPlainText(html) : undefined);
  const payload = { from: FROM_EMAIL, to, subject, html, text: textPart, attachments };
  // Resend de-duplicates sends that share an Idempotency-Key (24h window) — a
  // second layer behind the durable emailLog claim in notificationService.js.
  const result = idempotencyKey
    ? await getResend().emails.send(payload, { idempotencyKey })
    : await getResend().emails.send(payload);
  if (result?.error) {
    const { name, message, statusCode } = result.error;
    throw new Error(`Resend rejected the email (${name}, HTTP ${statusCode}): ${message}`);
  }
  return result;
}

/**
 * Sent when a property is genuinely assigned to an agent (an admin assigns or
 * reassigns it, or a vendor submission arrives) — never when an agent uploads
 * their own property. Sent only through notificationService.sendPropertyReadyOnce,
 * which owns de-duplication and recipient eligibility.
 * The button opens the property's own dashboard page, which enforces sign-in and
 * the owner / office-admin / superAdmin access check.
 */
export async function sendPropertyReadyEmail(userEmail, userFirstName, propertyAddress, propertyId, { idempotencyKey } = {}) {
  const bodyHTML = `
    ${heading('Your property is ready to review')}
    ${greeting(esc(userFirstName))}
    ${p('A new property has been added to your Premarket dashboard.')}
    ${p('Review the details, prepare your campaign and start collecting valuable buyer feedback when you\u2019re ready.')}
    ${detailList([['Property', esc(propertyAddress)]])}
    ${steps([
      'Review your property details and photos.',
      'Make any final adjustments.',
      'Activate your campaign when you\u2019re ready.',
    ], 'Next steps')}
    ${ctaButton('View Property', `${BASE_URL}/dashboard/property/${encodeURIComponent(propertyId)}`)}
    ${signature()}
  `;

  return sendEmail({
    to: userEmail,
    subject: 'Your property is ready to review | Premarket',
    idempotencyKey,
    html: wrapEmail({
      previewText: `${esc(propertyAddress)} has been added to your Premarket dashboard`,
      bodyHTML,
      recipientEmail: userEmail,
      reason: "You're receiving this because a property was added to your Premarket account.",
    }),
  });
}

/**
 * Sent when a property goes live on the platform.
 * No longer references "approval" — everything is auto-approved.
 * Educates about private vs public listing visibility.
 */
export async function sendPropertyLiveEmail(userEmail, userFirstName, propertyAddress, visibility) {
  const isPublic = visibility === true;
  const visibilityLabel = isPublic ? 'Public' : 'Private (Premarket)';
  const visibilityColor = isPublic ? '#10b981' : '#f59e0b';

  const bodyHTML = `
    ${greeting(userFirstName)}
    ${p(`Great news — your property at <strong>${propertyAddress}</strong> is now live on Premarket.`)}

    ${infoBox(`
      <p class="t-muted" style="margin:0 0 8px 0; font-size:13px; font-weight:600; color:#64748b; text-transform:uppercase; letter-spacing:0.5px;">Current Listing Visibility</p>
      <p style="margin:0 0 12px 0; font-size:18px; font-weight:700; color:${visibilityColor};">${visibilityLabel}</p>
      <p class="t-muted" style="margin:0; font-size:13px; color:#64748b; line-height:1.5;">
        ${isPublic
          ? '<strong>Public</strong> — Your property is visible to all buyers on Premarket and in search results.'
          : '<strong>Private (Premarket)</strong> — Your property is only visible to matched buyers and invited buyer\'s agents. It won\'t appear in public search results. This is ideal for testing interest before going to market.'
        }
      </p>
      <p class="t-muted" style="margin:8px 0 0 0; font-size:12px; color:#94a3b8;">You can change visibility anytime from your dashboard.</p>
    `)}

    ${p('You can now start attracting buyer interest. Share your property link with potential buyers or let our matching system do the work.')}
    ${ctaButton('View Your Property', `${BASE_URL}/dashboard`)}
    ${signature()}
  `;

  return sendEmail({
    to: userEmail,
    subject: 'Your property is now live on Premarket',
    html: wrapEmail({
      previewText: `Your property at ${propertyAddress} is now live on Premarket`,
      bodyHTML,
      recipientEmail: userEmail,
      reason: "You're receiving this because you listed a property on Premarket.",
    }),
  });
}

// Keep old name as alias for backwards compatibility during migration
export const sendPropertyApprovalEmail = (email, name, address, visibility) =>
  sendPropertyLiveEmail(email, name, address, visibility);

/**
 * Sent to agents when a new prospect (vendor) adds their property.
 */
export async function sendPropertyAgentEmail(userEmail, userFirstName, propertyAddress) {
  const bodyHTML = `
    ${greeting(userFirstName)}
    ${p(`A new prospect has added their home at <strong>${propertyAddress}</strong> to your Premarket profile.`)}
    ${p("You'll find this property in your <strong>Premarket dashboard</strong>.")}

    ${infoBox(`
      <p class="t-ink" style="margin:0 0 10px 0; font-size:14px; font-weight:600; color:#1a1a2e;">What to do next:</p>
      <ol class="t-body" style="margin:0; padding-left:18px; color:#4b5563; font-size:14px; line-height:1.8;">
        <li>Review and edit the listing details</li>
        <li>Activate your AI Agent to generate video content</li>
        <li>Choose visibility — keep it <strong>Private</strong> for premarket interest, or make it <strong>Public</strong></li>
        <li>Share with your buyer network</li>
      </ol>
    `)}

    ${p('Need more campaign slots? Our team can help.')}
    ${ctaButton('Open Dashboard', `${BASE_URL}/dashboard`)}
    ${ctaButtonDark('Chat with Sales', 'https://calendly.com/knockknock-premarket')}
    ${signature()}
  `;

  return sendEmail({
    to: userEmail,
    subject: `New Prospect Added: ${propertyAddress}`,
    html: wrapEmail({
      previewText: `A new prospect added ${propertyAddress} to your profile`,
      bodyHTML,
      recipientEmail: userEmail,
      reason: "You're receiving this because a vendor added a property to your Premarket profile.",
    }),
  });
}

const NEXT_ACTION_LABELS = {
  contact: 'Have the agent contact them',
  inspection: 'Arrange an inspection',
  info: 'Send more information',
};

const TIMEFRAME_LABELS = {
  asap: 'ASAP',
  '1_3_months': '1–3 months',
  '3_6_months': '3–6 months',
  '6_12_months': '6–12+ months',
  just_exploring: 'Just exploring',
};

const FINANCE_LABELS = {
  cash: 'Cash buyer',
  approved_finance: 'Finance approved',
  pre_approval: 'Pre-approval in progress',
  not_yet: "Hasn't started finance yet",
};

// Buyer-supplied free text (name, email, phone) ends up interpolated
// straight into this email's HTML — escaped here rather than trusted, so
// a buyer entering something like `<img onerror=...>` as their name
// can't inject markup into an agent's inbox.
function escapeHtml(value) {
  if (!value) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Plain label/value row for the buyer-interest notification. Deliberately
// unstyled beyond a bold label: this is an operational alert, not a campaign.
function detailRow(label, valueHTML) {
  return `
    <tr>
      <td style="padding:2px 12px 2px 0; color:#6b7280; vertical-align:top; white-space:nowrap;">${label}</td>
      <td style="padding:2px 0; vertical-align:top;">${valueHTML}</td>
    </tr>
  `;
}

// A titled block of detailRow()s — plain text weight, no card chrome.
function detailCard(title, rowsHTML) {
  return `
    <p style="margin:20px 0 6px 0; font-weight:700;">${title}</p>
    <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
      ${rowsHTML}
    </table>
  `;
}

// Minimal transactional shell for the buyer-interest notification: no logo
// banner, accent bar, dark-mode CSS, unsubscribe link or copyright footer.
// Local on purpose — the shared wrapEmail() keeps every other email's look.
function wrapPlainNotification({ bodyHTML, previewText, reason }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Buyer registration</title>
</head>
<body style="margin:0; padding:0; background-color:#ffffff;">
  <div style="display:none; max-height:0; overflow:hidden; font-size:1px; line-height:1px; color:#ffffff;">${previewText}</div>
  <div style="max-width:560px; margin:0 auto; padding:24px 20px; font-family:Arial, Helvetica, sans-serif; font-size:15px; line-height:1.6; color:#111827;">
    ${bodyHTML}
    <p style="margin:28px 0 0 0; font-size:12px; color:#6b7280;">${reason}</p>
  </div>
</body>
</html>`;
}

// Strips everything except a leading + and digits, so "0400 000 000"
// or "(04) 0000 0000" still produces a dialable tel: href — the
// escaped original (with its own formatting) stays the visible text.
function toTelHref(phone) {
  if (!phone) return '';
  return String(phone).replace(/[^0-9+]/g, '');
}

/**
 * Sent to the owning agent the moment a buyer registers formal interest —
 * the only real-time lead notification in the product today; everything
 * else requires the agent to open their dashboard. See
 * api/offers/notify-interest/route.js for when/why this fires, and for
 * why propertyAddress is always the full street address here even for a
 * property an anonymous buyer would only see as a suburb — showSuburbOnly
 * is a buyer-facing privacy setting, meaningless to the agent who already
 * owns this exact listing.
 *
 * Shows only the registration fields that were actually collected —
 * never infers or labels a buyer "qualified" or "serious" beyond what
 * their own answers say. Buyer email/phone are shown in full, as
 * clickable mailto:/tel: links, never masked: this notification only
 * ever goes to the one agent who owns the property the buyer registered
 * on (resolved server-side in notify-interest/route.js from the
 * property's own record, never from client input), which is exactly the
 * sharing the registration form's own consent copy describes.
 */
export async function sendNewBuyerInterestEmail({
  agentEmail,
  agentFirstName,
  propertyAddress,
  propertyId,
  offerId,
  buyerName,
  buyerEmail,
  buyerPhone,
  nextAction,
  timeframe,
  buyerType,
  isFirstHomeBuyer,
  isInvestor,
}) {
  const actionLabel = NEXT_ACTION_LABELS[nextAction] || NEXT_ACTION_LABELS.contact;
  const timeframeLabel = TIMEFRAME_LABELS[timeframe];
  const financeLabel = FINANCE_LABELS[buyerType];
  const safeName = escapeHtml(buyerName) || 'A buyer';
  const safeAddress = escapeHtml(propertyAddress);
  const safeEmail = escapeHtml(buyerEmail);
  const safePhone = escapeHtml(buyerPhone);
  const telHref = escapeHtml(toTelHref(buyerPhone));

  const buyerTypeTags = [
    isFirstHomeBuyer ? 'First home buyer' : null,
    isInvestor ? 'Investor' : null,
  ].filter(Boolean);

  const buyerDetailsRows = [
    detailRow('Name', safeName),
    safeEmail ? detailRow('Email', `<a href="mailto:${safeEmail}" style="color:#1d4ed8; text-decoration:underline;">${safeEmail}</a>`) : '',
    safePhone ? detailRow('Phone', `<a href="tel:${telHref}" style="color:#1d4ed8; text-decoration:underline;">${safePhone}</a>`) : '',
  ].filter(Boolean).join('');

  // Every row here is conditional — only what this buyer actually
  // submitted is shown. "Wants" is the one field that's always present,
  // since the registration form always collects it (with a default).
  const submittedRows = [
    detailRow('Wants', `<strong>${actionLabel}</strong>`),
    timeframeLabel ? detailRow('Timeframe', timeframeLabel) : '',
    financeLabel ? detailRow('Finance', financeLabel) : '',
    buyerTypeTags.length > 0 ? detailRow('Buyer type', buyerTypeTags.join(' &middot; ')) : '',
  ].filter(Boolean).join('');

  // Deep-links to this exact registration (offerId) inside the property report.
  const dashboardUrl = `${BASE_URL}${buildRegistrationPath(propertyId, offerId)}`;

  const safeFirstName = escapeHtml(agentFirstName);
  const bodyHTML = `
    <p style="margin:0 0 14px 0;">Hi ${safeFirstName || 'there'},</p>
    <p style="margin:0 0 6px 0;"><strong>${safeName}</strong> registered interest in <strong>${safeAddress}</strong>.</p>

    ${detailCard('Buyer details', buyerDetailsRows)}
    ${detailCard('What the buyer told us', submittedRows)}

    <p style="margin:20px 0 6px 0; font-weight:700;">Next step</p>
    <p style="margin:0;">
      Contact ${safeName} directly, or view the full registration in your Premarket dashboard:<br>
      <a href="${dashboardUrl}" style="color:#1d4ed8; text-decoration:underline;">View registration</a>
    </p>
  `;

  // null means "omit this line entirely" (a field that wasn't
  // collected) — kept distinct from '' (a deliberate blank separator
  // line between sections), so filtering one never swallows the other.
  const plainTextLines = [
    `Hi ${agentFirstName || 'there'},`,
    '',
    `${buyerName || 'A buyer'} registered interest in ${propertyAddress}.`,
    '',
    'BUYER DETAILS',
    `Name: ${buyerName || ''}`,
    buyerEmail ? `Email: ${buyerEmail}` : null,
    buyerPhone ? `Phone: ${buyerPhone}` : null,
    '',
    'WHAT THE BUYER TOLD US',
    `Wants: ${actionLabel}`,
    timeframeLabel ? `Timeframe: ${timeframeLabel}` : null,
    financeLabel ? `Finance: ${financeLabel}` : null,
    buyerTypeTags.length > 0 ? `Buyer type: ${buyerTypeTags.join(', ')}` : null,
    '',
    'NEXT STEP',
    `Contact ${buyerName || 'the buyer'} directly, or view the full registration in your Premarket dashboard:`,
    dashboardUrl,
    '',
    "You're receiving this because a buyer registered interest in your property on Premarket.",
  ].filter((line) => line !== null);

  // Header values must stay on one line, whatever the buyer typed.
  const oneLine = (v) => String(v || '').replace(/[\r\n]+/g, ' ').trim();

  return sendEmail({
    to: agentEmail,
    subject: `${oneLine(buyerName) || 'A buyer'} registered interest in ${oneLine(propertyAddress)}`,
    html: wrapPlainNotification({
      previewText: `${safeName} registered interest in ${safeAddress}`,
      bodyHTML,
      reason: "You're receiving this because a buyer registered interest in your property on Premarket.",
    }),
    text: plainTextLines.join('\n'),
  });
}

/**
 * Property link email — QR + CRM distribution instructions.
 */
export async function sendLink(link, email) {
  const qrImage = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(link)}`;

  const crmSection = (name, color, steps) => `
    <div style="margin:16px 0;">
      <p style="margin:0 0 6px 0; font-size:14px; font-weight:600; color:${color};">${name}</p>
      <ol class="t-body" style="margin:0; padding-left:18px; color:#4b5563; font-size:13px; line-height:1.7;">${steps.map(s => `<li>${s}</li>`).join('')}</ol>
    </div>
  `;

  const bodyHTML = `
    ${heading('Your Premarket property link')}
    ${p('Scan the QR code or use the link below to share your property with buyers.')}

    <div style="text-align:center; margin:24px 0;">
      <img src="${qrImage}" alt="Property QR Code" style="max-width:180px; border:1px solid #e2e8f0; border-radius:10px;" />
    </div>

    <div class="bg-panel line" style="text-align:center; margin:16px 0; background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:14px;">
      <a class="link" href="${link}" style="word-break:break-all; font-size:14px; font-weight:600; color:#ea580c; text-decoration:none;">${link}</a>
    </div>

    <p class="t-ink" style="margin:28px 0 8px 0; font-size:13px; font-weight:700; color:#0f172a; text-transform:uppercase; letter-spacing:0.6px;">How to send this link to your buyers</p>

    ${crmSection('Reapit CRM', '#0f172a', [
      'Log into <strong>Reapit</strong> and go to the <em>Contacts</em> tab.',
      'Filter buyers by criteria (location, budget, property type).',
      'Click <em>Save as List</em> and name your buyer group.',
      'Choose <em>Email Buyers</em> and create a new email campaign.',
      'Paste the Premarket link above into your email template and send.',
    ])}

    ${crmSection('Agentbox CRM', '#0f172a', [
      'Log into <strong>Agentbox</strong> and open the <em>Contacts</em> section.',
      'Use filters (suburb, price, property type) to segment your buyers.',
      'Select <em>Add to Mailing List</em> and create a new buyer group.',
      'Go to <em>Email Marketing</em>, choose the buyer group, and start a new campaign.',
      'Insert the Premarket link above in your email body and send to buyers.',
    ])}

    ${crmSection('Mailchimp or Other Mailing Lists', '#0f172a', [
      'Log into <strong>Mailchimp</strong> (or your email tool) and create/import your buyer list.',
      'Create a new <em>Campaign</em> and select your buyer list.',
      'Design the email template and add the Premarket link as a call-to-action button.',
      'Preview, test, and send the email to your buyers.',
    ])}

    ${signature()}
  `;

  return sendEmail({
    to: email,
    subject: "Here's your property link to share with buyers",
    html: wrapEmail({
      previewText: 'Your Premarket property link is ready to share',
      bodyHTML,
      recipientEmail: email,
      reason: "You're receiving this because you requested a property link from Premarket.",
    }),
  });
}

/**
 * Property follow-up email — sent 14 or 30 days after listing.
 * Asks if the property has been sold and links to sold entry page.
 */
export async function sendPropertyFollowUpEmail(userEmail, userFirstName, propertyAddress, propertyId, daysSinceListed) {
  const soldUrl = `${BASE_URL}/dashboard/property/${propertyId}/sold`;
  const isFirst = daysSinceListed <= 14;

  const bodyHTML = `
    ${greeting(userFirstName)}
    ${p(`It's been <strong>${daysSinceListed} days</strong> since you listed <strong>${propertyAddress}</strong> on Premarket.`)}

    ${isFirst
      ? p("We'd love to know how things are going. Has your property sold or received an offer?")
      : p("Just checking in again. If your property has sold or you've accepted an offer, let us know so we can update your listing.")
    }

    ${infoBox(`
      <p class="t-ink" style="margin:0 0 8px 0; font-size:14px; font-weight:600; color:#1a1a2e;">Has this property been sold?</p>
      <p class="t-muted" style="margin:0; font-size:13px; color:#64748b; line-height:1.5;">
        If your property has sold, you can record the sold price and archive the listing. This helps us track market activity and improve results for everyone.
      </p>
    `)}

    ${ctaButton('Record Sale & Archive', soldUrl)}

    ${p("If your property is still on the market, no action needed — we'll keep promoting it to matched buyers.")}
    ${signature()}
  `;

  return sendEmail({
    to: userEmail,
    subject: `${isFirst ? 'How is your listing going?' : 'Quick check-in'} — ${propertyAddress}`,
    html: wrapEmail({
      previewText: `Has ${propertyAddress} been sold? Let us know`,
      bodyHTML,
      recipientEmail: userEmail,
      reason: "You're receiving this because you have an active listing on Premarket.",
    }),
  });
}

/**
 * Branded password reset email.
 */
export async function sendPasswordResetEmailTemplate(userEmail, userFirstName, resetLink) {
  const bodyHTML = `
    ${greeting(userFirstName)}
    ${p('We received a request to reset the password for your Premarket account.')}
    ${p('Click the button below to choose a new password:')}
    ${ctaButton('Reset Password', resetLink)}
    ${infoBox(`
      <p class="t-muted" style="margin:0; font-size:13px; color:#64748b; line-height:1.5;">
        This link will expire in <strong>1 hour</strong>. If you didn't request a password reset, you can safely ignore this email — your password won't be changed.
      </p>
    `)}
    ${signature()}
  `;

  return sendEmail({
    to: userEmail,
    subject: 'Reset your Premarket password',
    html: wrapEmail({
      previewText: 'Reset your Premarket password',
      bodyHTML,
      recipientEmail: userEmail,
      reason: "You're receiving this because a password reset was requested for your account.",
    }),
  });
}

// The initial invitation is shared by every office. Harcourts Property Hub (the launch partner)
// gets an extended onboarding version; every other office keeps the original email unchanged.
//
// Identified by name, not officeId: office ids are random Firestore auto-ids that the codebase
// never records, so there is no verified HPH id to compare against. The name is a safe key here
// because callers pass the stored office record's own name, active offices cannot share an exact
// name (see findOfficeByExactName in officeService.js) and nothing renames an office. The
// normalisation matches normalizeAgencyNameExact in brandProfileService.js (kept inline so this
// email service doesn't import a Firestore module); only an exact match counts, never a prefix.
const isHphOffice = (officeName) => String(officeName || '').trim().toLowerCase().replace(/\s+/g, ' ') === 'harcourts property hub';

const sectionTitle = (text) =>
  `<p class="t-ink" style="margin:0 0 12px 0; font-size:12px; font-weight:700; color:${COLORS.ink}; text-transform:uppercase; letter-spacing:1.2px;">${text}</p>`;

const featureLine = (name, text) =>
  `<p class="t-body" style="margin:0 0 12px 0; font-size:14px; color:${COLORS.body}; line-height:1.6;"><strong class="t-ink" style="color:${COLORS.ink};">${name}</strong> &mdash; ${text}</p>`;

// Activation details are identical to the standard email; only the welcome and the sections after
// the activation steps are added. `office` is already escaped.
function hphOfficeInviteBody({ office, email, firstName, activationLink }) {
  return `
    ${eyebrow('Welcome to Premarket')}
    ${heading(`${office} has set up your Premarket account`)}
    ${greeting(esc(firstName))}
    ${lead(`Welcome to Premarket. ${office} is our launch partner, and your account is ready &mdash; all that's left is to choose a password.`)}
    ${p('Premarket is where you run premarket campaigns, gather anonymous buyer pricing opinions and see buyer interest, before and during a campaign.')}
    ${detailList([
      ['Office', office],
      ['Your login', esc(email)],
      ['Branding', 'Applied automatically'],
    ], 'Your account')}
    ${ctaButton('Activate your account', activationLink, { fallback: true })}
    ${divider()}
    ${steps([
      'Select <strong>Activate your account</strong>.',
      'Choose your own password. We never email passwords.',
      `Arrive in your dashboard, already connected to <strong>${office}</strong>.`,
    ])}
    ${infoBox(`
      <p class="t-body" style="margin:0; font-size:13px; color:${COLORS.body}; line-height:1.65;">
        <strong class="t-ink" style="color:${COLORS.ink};">This link is personal to you</strong> and stays valid for 14 days. If it has expired, ask your office administrator to resend your invitation. If you weren't expecting this email, you can safely ignore it.
      </p>
    `, { tone: 'warm' })}
    ${divider()}
    ${sectionTitle('Your HPH Agent Hub')}
    ${p('A short guide built for HPH agents, in three parts:')}
    ${featureLine('Win the Listing', 'use Premarket as a point of difference in listing presentations, with a script you can use with hesitant vendors.')}
    ${featureLine('Premarket', 'introduce a property to the buyers in your database and gather anonymous price opinions before you go to market.')}
    ${featureLine('Price Intelligence', 'collect buyer pricing opinions throughout a live campaign to support earlier, evidence-based vendor conversations.')}
    ${ctaButtonDark('Open the HPH Agent Hub', `${BASE_URL}/hph-agent-hub`)}
    ${infoBox(`
      ${sectionTitle('My Team')}
      <p class="t-body" style="margin:0; font-size:14px; color:${COLORS.body}; line-height:1.65;">
        Once you're in, open <strong class="t-ink" style="color:${COLORS.ink};">My Team</strong> in your dashboard to invite colleagues from your office by email. Once they accept, you can each see the other's campaigns and buyer feedback, read-only.
      </p>
    `)}
    ${signature()}
  `;
}

/**
 * Office activation invite — sent to a BRAND-NEW agent account created
 * by an office's CSV import or "add an agent" action. `activationLink`
 * is a Firebase Admin SDK generatePasswordResetLink (see
 * officeImportService.js) — the same primitive /api/admin/users/[id]/
 * reset-password already uses, just framed as account setup rather
 * than a password reset. Never contains a password — the agent sets
 * their own via Firebase's own secure link flow.
 */
export async function sendOfficeInviteEmail(email, firstName, officeName, activationLink) {
  const office = esc(officeName);
  const hph = isHphOffice(officeName);
  const bodyHTML = hph ? hphOfficeInviteBody({ office, email, firstName, activationLink }) : `
    ${eyebrow('Office invitation')}
    ${heading(`${office} has set up your Premarket account`)}
    ${greeting(esc(firstName))}
    ${lead(`Your office uses Premarket to run premarket campaigns and track buyer interest ahead of going to market. Your account is ready &mdash; all that's left is to choose a password.`)}
    ${detailList([
      ['Office', office],
      ['Your login', esc(email)],
      ['Branding', 'Applied automatically'],
    ], 'Your account')}
    ${ctaButton('Activate your account', activationLink, { fallback: true })}
    ${divider()}
    ${steps([
      'Select <strong>Activate your account</strong>.',
      'Choose your own password. We never email passwords.',
      `Arrive in your dashboard, already connected to <strong>${office}</strong>.`,
    ])}
    ${infoBox(`
      <p class="t-body" style="margin:0; font-size:13px; color:${COLORS.body}; line-height:1.65;">
        <strong class="t-ink" style="color:${COLORS.ink};">This link is personal to you</strong> and stays valid for 14 days. If it has expired, ask your office administrator to resend your invitation. If you weren't expecting this email, you can safely ignore it.
      </p>
    `, { tone: 'warm' })}
    ${signature()}
  `;

  return sendEmail({
    to: email,
    subject: `You've been invited to join ${officeName} on Premarket`,
    html: wrapEmail({
      previewText: hph
        ? `Welcome to Premarket. Your ${office} account is ready: activate it in one click.`
        : `${office} has set up your Premarket account. Activate it in one click.`,
      bodyHTML,
      recipientEmail: email,
      reason: `You're receiving this because ${esc(officeName)} added you to their Premarket office account.`,
    }),
  });
}

/**
 * Office join invite — sent to an agent who ALREADY has a Premarket
 * account when an office imports/adds them. Deliberately a different,
 * lighter email to sendOfficeInviteEmail above: no password/activation
 * step at all, just a one-click confirmation (see
 * officeImportService.js's acceptOfficeInvite) — they keep using their
 * existing login, and nothing about their account changes unless they
 * explicitly accept.
 */
export async function sendOfficeJoinInviteEmail(email, firstName, officeName, acceptLink) {
  const office = esc(officeName);
  const bodyHTML = `
    ${eyebrow('Office invitation')}
    ${heading(`${office} has invited you to join their office`)}
    ${greeting(esc(firstName))}
    ${lead(`You already have a Premarket login, so there's no new password to set. Nothing changes on your account until you confirm.`)}
    ${detailList([
      ['Office', office],
      ['Your login', esc(email)],
      ['What changes', `Your campaigns will show ${office}'s branding`],
    ], 'Invitation')}
    ${ctaButton(`Join ${office}`, acceptLink, { fallback: true })}
    ${infoBox(`
      <p class="t-body" style="margin:0; font-size:13px; color:${COLORS.body}; line-height:1.65;">
        <strong class="t-ink" style="color:${COLORS.ink};">Not expecting this?</strong> You can safely ignore this email &mdash; nothing about your account will change unless you select the button.
      </p>
    `, { tone: 'warm' })}
    ${signature()}
  `;

  return sendEmail({
    to: email,
    subject: `${officeName} added you to their Premarket office`,
    html: wrapEmail({
      previewText: `${office} added you to their Premarket office. Confirm to join.`,
      bodyHTML,
      recipientEmail: email,
      reason: `You're receiving this because ${esc(officeName)} added your existing Premarket account to their office.`,
    }),
  });
}

/**
 * Team invitation — sent to ONE colleague in the inviter's own office, from the
 * "My Team" page only. Nothing changes until they sign in and accept; the email
 * carries no buyer or property data. Never part of any bulk/newsletter path.
 */
export async function sendTeamInviteEmail(email, firstName, inviterName, officeName, link) {
  const inviter = esc(inviterName);
  const office = esc(officeName);
  const bodyHTML = `
    ${eyebrow('Team invitation')}
    ${heading(`${inviter} invited you to a Premarket team`)}
    ${greeting(esc(firstName))}
    ${lead(`Teams let colleagues in ${office} see each other's campaigns and buyer feedback, read-only. You keep your own account, properties and billing.`)}
    ${detailList([
      ['Invited by', inviter],
      ['Office', office],
      ['What teammates can see', `Your properties and anonymous buyer feedback`],
      ['What they can&rsquo;t do', `Edit, delete, send reports, see buyer contact details or billing`],
    ], 'Invitation')}
    ${ctaButton('Review invitation', link, { fallback: true })}
    ${infoBox(`
      <p class="t-body" style="margin:0; font-size:13px; color:${COLORS.body}; line-height:1.65;">
        <strong class="t-ink" style="color:${COLORS.ink};">Not expecting this?</strong> You can decline from your dashboard or simply ignore this email. The invitation expires in 14 days and nothing changes unless you accept.
      </p>
    `, { tone: 'warm' })}
    ${signature()}
  `;

  return sendEmail({
    to: email,
    subject: `${inviterName} invited you to their Premarket team`,
    html: wrapEmail({
      previewText: `${inviter} invited you to share campaign feedback as a team. Accept or decline.`,
      bodyHTML,
      recipientEmail: email,
      reason: `You're receiving this because a colleague at ${esc(officeName)} invited you to their Premarket team.`,
    }),
  });
}

export { getResend as resend };
