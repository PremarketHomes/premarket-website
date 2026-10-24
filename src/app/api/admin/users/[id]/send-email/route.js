import { NextResponse } from 'next/server';
import { adminDb } from '../../../../../firebase/adminApp';
import { verifyAdmin } from '../../../../middleware/auth';

export async function POST(request, { params }) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { id } = await params;
    const { emailType } = await request.json();

    const userDoc = await adminDb.collection('users').doc(id).get();
    if (!userDoc.exists) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const userData = userDoc.data();
    const email = userData.email;
    if (!email) {
      return NextResponse.json({ error: 'User has no email' }, { status: 400 });
    }

    const validTypes = ['password_reset', 'welcome', 'property_live', 'follow_up'];
    if (!validTypes.includes(emailType)) {
      return NextResponse.json({ error: `Invalid email type. Valid: ${validTypes.join(', ')}` }, { status: 400 });
    }

    // Dynamic import to avoid build-time failures
    const { sendEmail } = await import('../../../../services/resendService');
    const { wrapEmail, heading, greeting, p, ctaButton, signature, esc } = await import('../../../../services/emailTemplates');
    const shell = (previewText, bodyHTML, reason) => wrapEmail({ previewText, bodyHTML, recipientEmail: email, reason });
    const first = esc(userData.firstName || '');

    let result;
    switch (emailType) {
      case 'password_reset': {
        const { getAuth } = await import('firebase-admin/auth');
        const resetLink = await getAuth().generatePasswordResetLink(email);
        result = await sendEmail({
          to: email,
          subject: 'Reset Your Password - Premarket',
          html: shell('Reset your Premarket password', `${heading('Reset your password')}${greeting(first)}${p('Click the button below to choose a new password.')}${ctaButton('Reset password', resetLink, { fallback: true })}${p('This link expires in 1 hour.')}${signature()}`, "You're receiving this because a password reset was requested for your account."),
        });
        break;
      }
      case 'welcome': {
        result = await sendEmail({
          to: email,
          subject: 'Welcome to Premarket!',
          html: shell('Welcome to Premarket', `${heading('Welcome to Premarket')}${greeting(first)}${p("We're excited to have you on board. Your dashboard is where you create campaigns and track buyer interest.")}${ctaButton('Open your dashboard', 'https://premarket.homes/dashboard')}${signature()}`, "You're receiving this because you have a Premarket account."),
        });
        break;
      }
      case 'property_live': {
        result = await sendEmail({
          to: email,
          subject: 'Your Property is Live on Premarket',
          html: shell('Your property is live on Premarket', `${heading('Your property is live')}${greeting(first)}${p('Your property listing is now live on Premarket and visible to buyers.')}${ctaButton('View your dashboard', 'https://premarket.homes/dashboard')}${signature()}`, "You're receiving this because you listed a property on Premarket."),
        });
        break;
      }
      case 'follow_up': {
        result = await sendEmail({
          to: email,
          subject: 'How are things going? - Premarket',
          html: shell('How are things going?', `${heading('How are things going?')}${greeting(first)}${p('Just checking in to see how things are going with your Premarket experience. Let us know if you need anything!')}${signature()}`, "You're receiving this because you have a Premarket account."),
        });
        break;
      }
    }

    return NextResponse.json({ success: true, emailType, to: email });
  } catch (err) {
    console.error('Send email error:', err);
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
  }
}
