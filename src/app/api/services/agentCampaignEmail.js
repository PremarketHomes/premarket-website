import { sendEmail } from './resendService';
import { wrapEmail, ctaButton, greeting, p, signature, heading, detailList, steps, esc, BASE_URL } from './emailTemplates';

export const buyerLinkFor = (propertyId) => `${BASE_URL}/find-property?propertyId=${encodeURIComponent(propertyId)}`;

/**
 * "Your campaign is live: here is your link" for an agent whose campaign was set up for them by their
 * office. Works without a Premarket login: the buyer link is the whole point. Contains the property address,
 * the agent's campaign link and how to share it. Contains no buyer data and no price information.
 */
export async function sendCampaignLinkToAgentEmail({ to, firstName, propertyAddress, propertyId, createdByName, resend = false, idempotencyKey }) {
  const link = buyerLinkFor(propertyId);
  const by = createdByName ? `${esc(createdByName)} at your office has` : 'Your office has';
  const bodyHTML = `
    ${heading(resend ? 'Your Premarket campaign link' : 'Your Premarket campaign is ready to share')}
    ${greeting(esc(firstName))}
    ${p(resend ? 'Here is your campaign link again.' : `${by} set up a Premarket campaign for you.`)}
    ${detailList([['Property', esc(propertyAddress)], ['Your campaign link', `<a href="${esc(link)}" style="color:#ea580c; word-break:break-all;">${esc(link)}</a>`]])}
    ${steps([
      'Copy your campaign link above.',
      'Paste it into an email or message to the buyers in your database (your CRM, Mailchimp, or a personal email).',
      'Buyers can share a private price opinion and register interest. You will be emailed when someone registers.',
    ], 'How to share it')}
    ${ctaButton('Open your campaign link', link)}
    ${p('You do not need to log in to Premarket to share this link.')}
    ${signature()}
  `;
  return sendEmail({
    to,
    subject: `Your Premarket campaign link: ${String(propertyAddress || 'your property').replace(/[\r\n]+/g, ' ').slice(0, 120)}`,
    idempotencyKey,
    html: wrapEmail({
      previewText: `Your campaign link for ${esc(propertyAddress)} is ready to share`,
      bodyHTML,
      recipientEmail: to,
      reason: "You're receiving this because your office set up a Premarket campaign for you.",
    }),
  });
}
