import { NextResponse } from 'next/server';
import { adminDb } from '../../../../../firebase/adminApp';
import { getAuth } from 'firebase-admin/auth';
import { verifyAdmin } from '../../../../middleware/auth';

/**
 * POST /api/admin/users/[id]/reset-password
 * Send a password reset email via Firebase Auth.
 */
export async function POST(request, { params }) {
  try {
    const auth = await verifyAdmin(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { id } = await params;

    // Get user email from Firestore
    const userDoc = await adminDb.collection('users').doc(id).get();
    if (!userDoc.exists) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const email = userDoc.data().email;
    if (!email) {
      return NextResponse.json({ error: 'User has no email address' }, { status: 400 });
    }

    // Generate password reset link
    const firebaseAuth = getAuth();
    const resetLink = await firebaseAuth.generatePasswordResetLink(email);

    // Send via Resend
    const { Resend } = await import('resend');
    const { wrapEmail, heading, p, ctaButton } = await import('../../../../services/emailTemplates');
    const resend = new Resend(process.env.RESEND_API_KEY);

    await resend.emails.send({
      from: 'Premarket <no-reply@mail.premarket.homes>',
      to: email,
      subject: 'Reset your Premarket password',
      html: wrapEmail({
        previewText: 'Reset your Premarket password',
        recipientEmail: email,
        reason: "You're receiving this because a password reset was requested for your account.",
        bodyHTML: `
          ${heading('Reset your password')}
          ${p('A password reset was requested for your Premarket account. Click the button below to choose a new password.')}
          ${ctaButton('Reset password', resetLink, { fallback: true })}
          ${p("This link expires in 1 hour. If you didn't request this, you can safely ignore this email.")}
        `,
      }),
    });

    return NextResponse.json({ success: true, message: 'Password reset email sent' });
  } catch (err) {
    console.error('Password reset error:', err);
    return NextResponse.json({ error: 'Failed to send password reset email' }, { status: 500 });
  }
}
