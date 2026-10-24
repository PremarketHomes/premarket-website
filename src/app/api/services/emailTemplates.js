const BASE_URL = 'https://premarket.homes';
const LOGO_URL = 'https://premarketvideos.b-cdn.net/assets/logo.png';

// Premarket email design system. One place defines the look of every
// email the website sends; individual templates only compose the helpers
// below. Rules every helper follows, so it renders the same in Gmail,
// Outlook (Word engine), Apple Mail and phone clients:
//   - tables for layout, inline styles for everything that matters
//   - solid background colours only — NO gradients anywhere (Gmail and
//     Outlook drop them, which is what produced white-on-white buttons)
//   - system font stack (web fonts don't load in most inboxes)
//   - every button has a solid bgcolor, plus an Outlook VML version
// Dark mode is progressive enhancement through the <style> block below
// (Apple Mail, iOS Mail, Outlook apps); clients that ignore it just show
// the light design, which is fully designed on its own.

export const COLORS = {
  brand: '#ea580c',
  ink: '#0f172a',
  body: '#475569',
  muted: '#94a3b8',
  line: '#e2e8f0',
  page: '#f1f5f9',
  card: '#ffffff',
  panel: '#f8fafc',
  warm: '#fff7ed',
  warmLine: '#fed7aa',
  lead: '#334155',
};

const FONT = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

const DARK_CSS = `
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  @media (max-width: 620px) {
    .px { padding-left: 24px !important; padding-right: 24px !important; }
    .h1 { font-size: 24px !important; }
  }
  @media (prefers-color-scheme: dark) {
    .bg-page { background-color: #0b1020 !important; }
    .bg-card { background-color: #121a2e !important; border-color: #243049 !important; }
    .bg-panel { background-color: #1a2440 !important; border-color: #243049 !important; }
    .bg-warm { background-color: #2a1a12 !important; border-color: #5a3320 !important; }
    .t-lead { color: #e2e8f0 !important; }
    .step-dot { background-color: #2a1a12 !important; border-color: #5a3320 !important; }
    .t-ink { color: #f1f5f9 !important; }
    .t-body { color: #cbd5e1 !important; }
    .t-muted { color: #94a3b8 !important; }
    .line { border-color: #243049 !important; }
    .logo-chip { background-color: #ffffff !important; border-radius: 10px !important; padding: 8px 14px !important; }
    a.link { color: #fb923c !important; }
  }
`;

/** Escapes text that came from a user (office names, buyer names, etc.). */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Shared email template wrapper for all Premarket emails.
 *
 * @param {Object} opts
 * @param {string} opts.previewText - Hidden preview text for inbox snippets
 * @param {string} opts.bodyHTML - Main email content HTML
 * @param {string} opts.recipientEmail - For unsubscribe link
 * @param {string} [opts.reason] - Why they're getting this email
 * @param {string} [opts.orgLabel] - Business identity shown in the footer
 *   copyright. Defaults to the consumer-facing "Premarket Australia"
 *   brand every existing caller relies on; invoicing-related emails pass
 *   'Premarket Group Pty Ltd' instead, since a financial document should
 *   show the actual billing entity, not the marketing brand.
 * @param {boolean} [opts.showUnsubscribe=true] - Internal staff notifications
 *   (contact form, invoice-run alerts) pass false; every email to a
 *   customer keeps the unsubscribe link.
 */
export function wrapEmail({ previewText, bodyHTML, recipientEmail, reason, orgLabel = 'Premarket Australia', showUnsubscribe = true }) {
  const unsubUrl = `${BASE_URL}/unsubscribe?email=${encodeURIComponent(recipientEmail || '')}`;
  const year = new Date().getFullYear();
  // Zero-width padding stops clients appending body text to the preview.
  const preheader = previewText ? `${previewText}${'&#8199;&zwnj;'.repeat(40)}` : '';

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <meta name="x-apple-disable-message-reformatting">
  <title>Premarket</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <style>table, td, p, a, h1, h2 { font-family: Arial, Helvetica, sans-serif !important; }</style>
  <![endif]-->
  <style>${DARK_CSS}</style>
</head>
<body class="bg-page" bgcolor="${COLORS.page}" style="margin:0; padding:0; background-color:${COLORS.page}; font-family:${FONT}; color:${COLORS.body}; -webkit-text-size-adjust:100%;">
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:${COLORS.page};">${preheader}</div>
  <table role="presentation" class="bg-page" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.page}" style="background-color:${COLORS.page};">
    <tr><td align="center" style="padding:32px 16px 40px 16px;">
      <!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:600px;">

        <!-- Logo -->
        <tr><td align="center" style="padding:4px 0 26px 0;">
          <a href="${BASE_URL}" target="_blank" style="text-decoration:none;">
            <span class="logo-chip" style="display:inline-block;"><img src="${LOGO_URL}" alt="Premarket" width="140" style="display:block; width:140px; max-width:140px; height:auto; border:0;" /></span>
          </a>
        </td></tr>

        <!-- Card -->
        <tr><td class="bg-card line" bgcolor="${COLORS.card}" style="background-color:${COLORS.card}; border:1px solid ${COLORS.line}; border-radius:18px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td class="px" style="padding:44px 48px 40px 48px;">
              <!-- Accent mark -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px 0;"><tr><td width="40" height="3" bgcolor="${COLORS.brand}" style="width:40px; height:3px; line-height:3px; font-size:0; background-color:${COLORS.brand}; border-radius:2px;">&nbsp;</td></tr></table>
              ${bodyHTML}
            </td></tr>
          </table>
        </td></tr>

        <!-- Footer -->
        <tr><td align="center" style="padding:30px 24px 0 24px;">
          ${reason ? `<p class="t-muted" style="margin:0 0 18px 0; font-size:13px; line-height:1.6; color:${COLORS.muted};">${reason}</p>` : ''}
          <table role="presentation" width="48" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 18px auto;"><tr><td height="1" bgcolor="${COLORS.line}" class="line" style="height:1px; line-height:1px; font-size:0; background-color:${COLORS.line};">&nbsp;</td></tr></table>
          <p class="t-muted" style="margin:0 0 10px 0; font-size:12px; line-height:1.6; color:${COLORS.muted};">
            ${showUnsubscribe ? `<a class="link" href="${unsubUrl}" style="color:${COLORS.muted}; text-decoration:underline;">Unsubscribe</a>
            &nbsp;&nbsp;&middot;&nbsp;&nbsp;` : ''}
            <a class="link" href="${BASE_URL}/privacy" style="color:${COLORS.muted}; text-decoration:underline;">Privacy</a>
            &nbsp;&nbsp;&middot;&nbsp;&nbsp;
            <a class="link" href="${BASE_URL}" style="color:${COLORS.muted}; text-decoration:underline;">premarket.homes</a>
          </p>
          <p class="t-muted" style="margin:0; font-size:11px; line-height:1.5; color:${COLORS.muted};">&copy; ${year} ${orgLabel}. All rights reserved.</p>
        </td></tr>

      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Bulletproof button: a solid-colour table cell (bgcolor, so it still
 * shows if CSS is stripped), white text, plus a VML rounded rectangle
 * for Outlook's Word engine. Pass `{ fallback: true }` to add a visible
 * copy-and-paste link underneath for clients that block or restyle
 * buttons.
 */
function bulletproofButton(text, href, solid, { fallback = false } = {}) {
  const width = Math.min(360, Math.max(220, String(text).length * 9 + 72));
  const fallbackHTML = fallback
    ? `<p class="t-muted" style="margin:0 0 4px 0; text-align:center; font-size:12px; color:${COLORS.muted}; line-height:1.6; word-break:break-all;">Button not working? Copy and paste this link into your browser:<br><a class="link" href="${href}" style="color:${solid}; text-decoration:underline;">${href}</a></p>`
    : '';
  return `<table role="presentation" align="center" border="0" cellspacing="0" cellpadding="0" style="margin:30px auto 22px auto;">
  <tr><td align="center" bgcolor="${solid}" style="background-color:${solid}; border-radius:12px;">
    <!--[if mso]>
    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:52px; v-text-anchor:middle; width:${width}px;" arcsize="22%" stroke="f" fillcolor="${solid}">
      <w:anchorlock/>
      <center style="color:#ffffff; font-family:Arial, sans-serif; font-size:16px; font-weight:bold;">${text}</center>
    </v:roundrect>
    <![endif]-->
    <!--[if !mso]><!-- -->
    <a href="${href}" target="_blank" style="display:inline-block; min-width:${width - 64}px; padding:16px 36px; background-color:${solid}; color:#ffffff; text-decoration:none; border-radius:12px; font-size:16px; font-weight:600; letter-spacing:0.1px; line-height:20px; text-align:center; font-family:${FONT};"><span style="color:#ffffff;">${text}</span></a>
    <!--<![endif]-->
  </td></tr>
</table>${fallbackHTML}`;
}

/** Primary (orange) button. */
export function ctaButton(text, href, opts) {
  return bulletproofButton(text, href, COLORS.brand, opts);
}

/** Secondary (dark) button. */
export function ctaButtonDark(text, href, opts) {
  return bulletproofButton(text, href, COLORS.ink, opts);
}

/** Info box: a quiet panel for supporting detail. */
export function infoBox(html, { tone = 'neutral' } = {}) {
  const warm = tone === 'warm';
  const bg = warm ? COLORS.warm : COLORS.panel;
  const border = warm ? COLORS.warmLine : COLORS.line;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
  <tr><td class="${warm ? 'bg-warm' : 'bg-panel'} line" bgcolor="${bg}" style="background-color:${bg}; border:1px solid ${border}; border-radius:14px; padding:20px 24px;">
    ${html}
  </td></tr>
</table>`;
}

/** Small orange label above a heading, e.g. "Office invitation". */
export function eyebrow(text) {
  return `<p style="margin:0 0 12px 0; font-size:12px; font-weight:700; color:${COLORS.brand}; text-transform:uppercase; letter-spacing:1.6px;">${text}</p>`;
}

/** Main email heading. */
export function heading(text) {
  return `<h1 class="h1 t-ink" style="margin:0 0 22px 0; font-size:30px; line-height:1.2; font-weight:700; color:${COLORS.ink}; letter-spacing:-0.7px;">${text}</h1>`;
}

/** Greeting line ("Hi Sam,"). */
export function greeting(name) {
  return `<p class="t-ink" style="margin:0 0 14px 0; font-size:16px; font-weight:600; color:${COLORS.ink};">Hi ${name || 'there'},</p>`;
}

/** Standard paragraph. */
export function p(text) {
  return `<p class="t-body" style="margin:0 0 16px 0; font-size:15px; color:${COLORS.body}; line-height:1.7;">${text}</p>`;
}

/** Larger introductory paragraph, directly under the greeting. */
export function lead(text) {
  return `<p class="t-lead" style="margin:0 0 18px 0; font-size:17px; color:${COLORS.lead}; line-height:1.65;">${text}</p>`;
}

/** Thin divider between sections. */
export function divider() {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0;"><tr><td height="1" class="line" bgcolor="${COLORS.line}" style="height:1px; line-height:1px; font-size:0; background-color:${COLORS.line};">&nbsp;</td></tr></table>`;
}

/**
 * Key/value card ("Your account": office, login email...). Values must
 * already be escaped HTML.
 */
export function detailList(rows, title) {
  const body = rows
    .map(
      ([label, value], i) => `<tr>
      <td class="t-muted${i ? ' line' : ''}" width="38%" valign="top" style="padding:11px 12px 11px 0; ${i ? `border-top:1px solid ${COLORS.line}; ` : ''}font-size:12px; font-weight:600; color:${COLORS.muted}; text-transform:uppercase; letter-spacing:0.6px;">${label}</td>
      <td class="t-ink${i ? ' line' : ''}" valign="top" style="padding:11px 0; ${i ? `border-top:1px solid ${COLORS.line}; ` : ''}font-size:14px; font-weight:600; color:${COLORS.ink}; line-height:1.4; word-break:break-word;">${value}</td>
    </tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0;">
  <tr><td class="bg-panel line" bgcolor="${COLORS.panel}" style="background-color:${COLORS.panel}; border:1px solid ${COLORS.line}; border-radius:14px; padding:8px 24px;">
    ${title ? `<p class="t-ink" style="margin:14px 0 0 0; font-size:12px; font-weight:700; color:${COLORS.ink}; text-transform:uppercase; letter-spacing:1px;">${title}</p>` : ''}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${body}</table>
  </td></tr>
</table>`;
}

/** Numbered "what happens next" steps. Items are trusted HTML strings. */
export function steps(items, title = 'What happens next') {
  const rows = items
    .map(
      (item, i) => `<tr>
      <td width="40" valign="top" style="padding:0 0 16px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td class="step-dot" width="26" height="26" align="center" bgcolor="${COLORS.warm}" style="width:26px; height:26px; background-color:${COLORS.warm}; border:1px solid ${COLORS.warmLine}; border-radius:14px; color:${COLORS.brand}; font-size:13px; font-weight:700; line-height:26px; font-family:${FONT};">${i + 1}</td></tr></table></td>
      <td valign="top" class="t-body" style="padding:3px 0 16px 0; font-size:15px; line-height:1.6; color:${COLORS.body};">${item}</td>
    </tr>`,
    )
    .join('');
  return `<p class="t-ink" style="margin:30px 0 16px 0; font-size:12px; font-weight:700; color:${COLORS.ink}; text-transform:uppercase; letter-spacing:1.2px;">${title}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>`;
}

/** Signature. */
export function signature() {
  return `<p class="t-body" style="margin:28px 0 0 0; font-size:14px; color:${COLORS.body}; line-height:1.6;">Kind regards,<br/><strong class="t-ink" style="color:${COLORS.ink};">The Premarket Team</strong></p>`;
}

/**
 * Plain-text alternative derived from the HTML, so every email carries a
 * text part (better deliverability, and readable in text-only clients).
 * Button/links become "text (url)".
 */
export function toPlainText(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<div style="display:none[\s\S]*?<\/div>/gi, '')
    .replace(/<(style|head|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => {
      const text = label.replace(/<[^>]+>/g, '').trim();
      return text && text !== href ? `${text} (${href})` : href;
    })
    .replace(/<\/(p|h1|h2|h3|tr|li|table|div)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#8199;|&zwnj;/g, ' ')
    .replace(/&middot;/g, '·')
    .replace(/&copy;/g, '©')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export { BASE_URL, LOGO_URL };
