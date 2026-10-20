const BASE_URL = 'https://premarket.homes';
const LOGO_URL = 'https://premarketvideos.b-cdn.net/assets/logo.png';

/**
 * Shared email template wrapper for all Premarket emails.
 * Provides consistent dark-themed header, footer with unsubscribe, and layout.
 *
 * @param {Object} opts
 * @param {string} opts.previewText - Hidden preview text for inbox snippets
 * @param {string} opts.bodyHTML - Main email content HTML
 * @param {string} opts.recipientEmail - For unsubscribe link
 * @param {string} [opts.reason] - Why they're getting this email
 * @param {string} [opts.orgLabel] - Business identity shown in the header
 *   and footer copyright. Defaults to the consumer-facing "Premarket
 *   Australia" brand every existing caller relies on; invoicing-related
 *   emails pass 'Premarket Group Pty Ltd' instead, since a financial
 *   document should show the actual billing entity, not the marketing
 *   brand. Every other email is unaffected unless it explicitly opts in.
 */
export function wrapEmail({ previewText, bodyHTML, recipientEmail, reason, orgLabel = 'Premarket Australia' }) {
  const unsubUrl = `${BASE_URL}/unsubscribe?email=${encodeURIComponent(recipientEmail || '')}`;
  const year = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Premarket</title>
</head>
<body style="margin:0; padding:0; background-color:#f8fafc; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color:#333;">
  <div style="display:none; max-height:0; overflow:hidden;">${previewText || ''}</div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f8fafc;">
    <tr><td align="center" style="padding:40px 20px;">
      <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; width:100%;">

        <!-- Logo -->
        <tr><td align="center" style="padding:0 0 24px 0;">
          <a href="${BASE_URL}" style="text-decoration:none;">
            <img src="${LOGO_URL}" alt="Premarket" width="180" style="display:block; max-width:180px;" />
          </a>
        </td></tr>

        <!-- Header bar -->
        <tr><td style="background:linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%); border-radius:24px 24px 0 0; padding:32px 40px; text-align:center;">
          <p style="margin:0; font-size:13px; color:#94a3b8; letter-spacing:0.5px; text-transform:uppercase;">${orgLabel}</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="background:#ffffff; padding:40px 36px;">
          ${bodyHTML}
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#1a1a2e; border-radius:0 0 24px 24px; padding:28px 40px; text-align:center;">
          ${reason ? `<p style="margin:0 0 14px 0; font-size:13px; color:#94a3b8;">${reason}</p>` : ''}
          <table cellpadding="0" cellspacing="0" border="0" align="center">
            <tr>
              <td style="padding:0 10px;"><a href="${unsubUrl}" style="color:#6b7280; font-size:12px; text-decoration:none;">Unsubscribe</a></td>
              <td style="color:#4b5563; font-size:12px;">|</td>
              <td style="padding:0 10px;"><a href="${BASE_URL}/privacy" style="color:#6b7280; font-size:12px; text-decoration:none;">Privacy</a></td>
              <td style="color:#4b5563; font-size:12px;">|</td>
              <td style="padding:0 10px;"><a href="${BASE_URL}" style="color:#6b7280; font-size:12px; text-decoration:none;">premarket.homes</a></td>
            </tr>
          </table>
          <p style="margin:18px 0 0 0; font-size:11px; color:#4b5563;">&copy; ${year} ${orgLabel}. All rights reserved.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Orange CTA button
 */
export function ctaButton(text, href) {
  return `<div style="text-align:center; margin:28px 0;">
  <a href="${href}" style="display:inline-block; padding:14px 32px; background:linear-gradient(135deg, #f97316 0%, #ea580c 100%); color:#ffffff; text-decoration:none; border-radius:10px; font-size:15px; font-weight:700; letter-spacing:0.3px;">${text}</a>
</div>`;
}

/**
 * Dark CTA button
 */
export function ctaButtonDark(text, href) {
  return `<div style="text-align:center; margin:28px 0;">
  <a href="${href}" style="display:inline-block; padding:14px 32px; background:linear-gradient(135deg, #1a1a2e 0%, #2d2d44 100%); color:#ffffff; text-decoration:none; border-radius:10px; font-size:15px; font-weight:700; letter-spacing:0.3px;">${text}</a>
</div>`;
}

/**
 * Info box with a subtle background
 */
export function infoBox(html) {
  return `<div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:20px; margin:20px 0;">
  ${html}
</div>`;
}

/**
 * Heading + paragraph combo
 */
export function greeting(name) {
  return `<h2 style="margin:0 0 16px 0; font-size:22px; font-weight:700; color:#1a1a2e;">Hi ${name || 'there'},</h2>`;
}

/**
 * Standard paragraph
 */
export function p(text) {
  return `<p style="margin:0 0 16px 0; font-size:15px; color:#4b5563; line-height:1.6;">${text}</p>`;
}

/**
 * Signature
 */
export function signature() {
  return `<p style="margin:24px 0 0 0; font-size:14px; color:#6b7280; line-height:1.6;">Kind regards,<br/><strong style="color:#1a1a2e;">The Premarket Team</strong></p>`;
}

export { BASE_URL, LOGO_URL };
