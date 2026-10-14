import { Resend } from 'resend';
import { wrapEmail, ctaButton, ctaButtonDark, infoBox, greeting, p, signature, BASE_URL } from './emailTemplates';

const FROM_EMAIL = 'Premarket <no-reply@mail.premarket.homes>';

let _resend;
function getResend() {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

export async function sendEmail({ to, subject, html, attachments }) {
  return getResend().emails.send({ from: FROM_EMAIL, to, subject, html, attachments });
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
      <p style="margin:0 0 8px 0; font-size:13px; font-weight:600; color:#64748b; text-transform:uppercase; letter-spacing:0.5px;">Current Listing Visibility</p>
      <p style="margin:0 0 12px 0; font-size:18px; font-weight:700; color:${visibilityColor};">${visibilityLabel}</p>
      <p style="margin:0; font-size:13px; color:#64748b; line-height:1.5;">
        ${isPublic
          ? '<strong>Public</strong> — Your property is visible to all buyers on Premarket and in search results.'
          : '<strong>Private (Premarket)</strong> — Your property is only visible to matched buyers and invited buyer\'s agents. It won\'t appear in public search results. This is ideal for testing interest before going to market.'
        }
      </p>
      <p style="margin:8px 0 0 0; font-size:12px; color:#94a3b8;">You can change visibility anytime from your dashboard.</p>
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
    ${p("You'll find this property in your <strong>Prospects tab</strong> inside the Premarket app.")}

    ${infoBox(`
      <p style="margin:0 0 10px 0; font-size:14px; font-weight:600; color:#1a1a2e;">What to do next:</p>
      <ol style="margin:0; padding-left:18px; color:#4b5563; font-size:14px; line-height:1.8;">
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

/**
 * Sent to the owning agent the moment a buyer registers formal interest —
 * the only real-time lead notification in the product today; everything
 * else requires the agent to open their dashboard. See
 * api/offers/notify-interest/route.js for when/why this fires.
 */
export async function sendNewBuyerInterestEmail({
  agentEmail,
  agentFirstName,
  propertyAddress,
  propertyId,
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

  const tags = [
    isFirstHomeBuyer ? 'First home buyer' : null,
    isInvestor ? 'Investor' : null,
  ].filter(Boolean);

  const bodyHTML = `
    ${greeting(agentFirstName)}
    ${p(`<strong>${safeName}</strong> just registered their interest in <strong>${safeAddress}</strong>.`)}

    ${infoBox(`
      <p style="margin:0 0 10px 0; font-size:13px; font-weight:600; color:#64748b; text-transform:uppercase; letter-spacing:0.5px;">Wants</p>
      <p style="margin:0 0 14px 0; font-size:16px; font-weight:700; color:#1a1a2e;">${actionLabel}</p>
      ${safeEmail ? `<p style="margin:0 0 4px 0; font-size:14px; color:#4b5563;">${safeEmail}</p>` : ''}
      ${safePhone ? `<p style="margin:0; font-size:14px; color:#4b5563;">${safePhone}</p>` : ''}
      ${(timeframeLabel || financeLabel || tags.length > 0) ? `
        <div style="margin-top:14px; padding-top:14px; border-top:1px solid #e2e8f0;">
          ${timeframeLabel ? `<p style="margin:0 0 4px 0; font-size:13px; color:#94a3b8;">Buying timeframe: <span style="color:#4b5563;">${timeframeLabel}</span></p>` : ''}
          ${financeLabel ? `<p style="margin:0 0 4px 0; font-size:13px; color:#94a3b8;">Finance: <span style="color:#4b5563;">${financeLabel}</span></p>` : ''}
          ${tags.length > 0 ? `<p style="margin:0; font-size:13px; color:#94a3b8;">${tags.join(' &middot; ')}</p>` : ''}
        </div>
      ` : ''}
    `)}

    ${p('Buyer leads go cold fast — worth reaching out while this is fresh.')}
    ${ctaButton('View in Dashboard', `${BASE_URL}/dashboard/property/${propertyId}`)}
    ${signature()}
  `;

  return sendEmail({
    to: agentEmail,
    subject: `New buyer interest: ${propertyAddress}`,
    html: wrapEmail({
      previewText: `${safeName} registered interest in ${safeAddress}`,
      bodyHTML,
      recipientEmail: agentEmail,
      reason: "You're receiving this because a buyer registered interest in your property on Premarket.",
    }),
  });
}

/**
 * Vendor invite link email — sent by agents to invite vendors.
 */
export async function sendInviteLink(email, firstName, agentFirstName, link) {
  const qrImage = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(link)}`;

  const bodyHTML = `
    ${greeting(firstName)}
    ${p(`You've been invited by your agent to use <strong>Premarket</strong> — a simple way to test buyer interest in your property before deciding whether to take it to market.`)}
    ${p('Premarket is a secure platform your agent uses to manage premarket campaigns. By uploading your property details, your agent can quietly introduce it to active buyers and buyer\'s agents, gather feedback, and track interest — without public advertising or any obligation to sell.')}

    ${infoBox(`
      <p style="margin:0 0 10px 0; font-size:14px; font-weight:600; color:#1a1a2e;">Once your property is added:</p>
      <ul style="margin:0; padding-left:18px; color:#4b5563; font-size:14px; line-height:1.8;">
        <li>Your agent manages the campaign through their dashboard</li>
        <li>Buyer interest and enquiries are tracked</li>
        <li>Your agent will contact you with updates and a summary report</li>
        <li>You'll have clearer information to help decide what to do next</li>
      </ul>
    `)}

    ${p('<strong>Getting started is free.</strong> Scan the QR code or click the button below to upload your property details.')}

    <div style="text-align:center; margin:24px 0;">
      <img src="${qrImage}" alt="QR Code" style="max-width:180px; border:1px solid #e2e8f0; border-radius:10px;" />
    </div>

    ${ctaButton('Upload Your Property', link)}

    <div style="text-align:center; margin:16px 0; background:#f0fdf9; border:1px solid #d6f5e8; border-radius:8px; padding:12px;">
      <a href="${link}" style="word-break:break-all; font-size:13px; color:#00897b; text-decoration:none;">${link}</a>
    </div>

    ${infoBox(`
      <p style="margin:0 0 8px 0; font-size:14px; font-weight:600; color:#1a1a2e;">Tips for uploading your property photos</p>
      <p style="margin:0 0 10px 0; font-size:13px; color:#94a3b8; font-style:italic;">Simple phone photos are fine — don't stress!</p>
      <ul style="margin:0; padding-left:18px; color:#4b5563; font-size:13px; line-height:1.8;">
        <li>Take photos during the day using natural light</li>
        <li>Open blinds and curtains</li>
        <li>Capture main living areas, kitchen, exterior and outdoor spaces</li>
        <li>Use landscape mode on your phone</li>
        <li>Tidy surfaces and remove obvious clutter</li>
      </ul>
      <p style="margin:10px 0 0 0; font-size:13px; color:#64748b;">Premarket includes AI photo touch-ups, so your agent can enhance brightness, clarity and presentation.</p>
    `)}

    ${p('If you need help at any stage, your agent can guide you through the process.')}
    ${signature()}
  `;

  return sendEmail({
    to: email,
    subject: "You've been invited to join Premarket",
    html: wrapEmail({
      previewText: 'Your agent has invited you to list your property on Premarket',
      bodyHTML,
      recipientEmail: email,
      reason: "You're receiving this because your agent invited you to Premarket.",
    }),
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
      <ol style="margin:0; padding-left:18px; color:#4b5563; font-size:13px; line-height:1.7;">${steps.map(s => `<li>${s}</li>`).join('')}</ol>
    </div>
  `;

  const bodyHTML = `
    <h2 style="margin:0 0 8px 0; font-size:22px; font-weight:700; color:#1a1a2e; text-align:center;">Your Premarket Property Link</h2>
    ${p('Scan the QR code or use the link below to share your property with buyers.')}

    <div style="text-align:center; margin:24px 0;">
      <img src="${qrImage}" alt="Property QR Code" style="max-width:180px; border:1px solid #e2e8f0; border-radius:10px;" />
    </div>

    <div style="text-align:center; margin:16px 0; background:#f0fdf9; border:1px solid #d6f5e8; border-radius:8px; padding:14px;">
      <a href="${link}" style="word-break:break-all; font-size:15px; font-weight:bold; color:#00897b; text-decoration:none;">${link}</a>
    </div>

    <h3 style="margin:28px 0 16px 0; font-size:16px; font-weight:600; color:#1a1a2e;">How to Send This Link to Your Buyers</h3>

    ${crmSection('Reapit CRM', '#00897b', [
      'Log into <strong>Reapit</strong> and go to the <em>Contacts</em> tab.',
      'Filter buyers by criteria (location, budget, property type).',
      'Click <em>Save as List</em> and name your buyer group.',
      'Choose <em>Email Buyers</em> and create a new email campaign.',
      'Paste the Premarket link above into your email template and send.',
    ])}

    ${crmSection('Agentbox CRM', '#00897b', [
      'Log into <strong>Agentbox</strong> and open the <em>Contacts</em> section.',
      'Use filters (suburb, price, property type) to segment your buyers.',
      'Select <em>Add to Mailing List</em> and create a new buyer group.',
      'Go to <em>Email Marketing</em>, choose the buyer group, and start a new campaign.',
      'Insert the Premarket link above in your email body and send to buyers.',
    ])}

    ${crmSection('Mailchimp or Other Mailing Lists', '#00897b', [
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
      <p style="margin:0 0 8px 0; font-size:14px; font-weight:600; color:#1a1a2e;">Has this property been sold?</p>
      <p style="margin:0; font-size:13px; color:#64748b; line-height:1.5;">
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
      <p style="margin:0; font-size:13px; color:#64748b; line-height:1.5;">
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

export { getResend as resend };
