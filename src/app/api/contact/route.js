import { NextResponse } from 'next/server';
import { sendEmail } from '../services/resendService';
import { wrapEmail } from '../services/emailTemplates';

const TARGET = 'knockknock@premarket.homes';

const ALLOWED_TOPICS = new Set(['sales', 'support', 'general']);

function escape(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const TOPIC_LABEL = {
  sales: 'Sales enquiry',
  support: 'Support issue',
  general: 'General enquiry',
};

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { name = '', email = '', topic = 'general', message = '', company = '' } = body;

    // Honey pot — bots fill in `company`. Real users won't.
    if (company) {
      return NextResponse.json({ ok: true });
    }

    if (!name || !email || !message) {
      return NextResponse.json(
        { error: 'Name, email and message are required.' },
        { status: 400 }
      );
    }

    if (typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 });
    }

    if (message.length > 5000) {
      return NextResponse.json({ error: 'Message too long.' }, { status: 400 });
    }

    const topicKey = ALLOWED_TOPICS.has(topic) ? topic : 'general';
    const topicLabel = TOPIC_LABEL[topicKey];

    const emailBody = `
      <div>
        <div style="border-left:4px solid #e48900;padding-left:16px;margin-bottom:24px;">
          <p style="margin:0;font-size:11px;font-weight:700;color:#c64500;text-transform:uppercase;letter-spacing:1px;">${escape(topicLabel)}</p>
          <h1 style="margin:8px 0 0 0;font-size:22px;color:#0f172a;">New contact form submission</h1>
        </div>
        <table style="width:100%;border-collapse:collapse;background:#f8fafc;border-radius:12px;overflow:hidden;">
          <tr><td style="padding:14px 18px;font-size:13px;color:#64748b;width:120px;">Name</td><td style="padding:14px 18px;font-size:14px;color:#0f172a;font-weight:600;">${escape(name)}</td></tr>
          <tr><td style="padding:14px 18px;font-size:13px;color:#64748b;border-top:1px solid #e2e8f0;">Email</td><td style="padding:14px 18px;font-size:14px;color:#0f172a;font-weight:600;border-top:1px solid #e2e8f0;"><a href="mailto:${escape(email)}" style="color:#c64500;text-decoration:none;">${escape(email)}</a></td></tr>
          <tr><td style="padding:14px 18px;font-size:13px;color:#64748b;border-top:1px solid #e2e8f0;">Topic</td><td style="padding:14px 18px;font-size:14px;color:#0f172a;font-weight:600;border-top:1px solid #e2e8f0;">${escape(topicLabel)}</td></tr>
        </table>
        <div style="margin-top:24px;padding:20px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;">
          <p style="margin:0 0 8px 0;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Message</p>
          <p style="margin:0;font-size:15px;color:#0f172a;line-height:1.6;white-space:pre-wrap;">${escape(message)}</p>
        </div>
        <p style="margin-top:24px;font-size:12px;color:#94a3b8;">
          Sent from the Premarket contact form · premarket.homes/contact
        </p>
      </div>
    `;

    const html = wrapEmail({
      previewText: `${name} sent a message via the contact form`,
      bodyHTML: emailBody,
      recipientEmail: TARGET,
      reason: 'Internal notification from the premarket.homes contact form.',
      showUnsubscribe: false,
    });

    await sendEmail({
      to: TARGET,
      subject: `[${topicLabel}] ${name} via premarket.homes`,
      html,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Contact form error:', err);
    return NextResponse.json(
      { error: 'Could not send message. Please email knockknock@premarket.homes directly.' },
      { status: 500 }
    );
  }
}
