import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { adminDb } from '../../../firebase/adminApp';
import { verifyCron } from '../../middleware/auth';
import { buildAllContacts, writeContacts } from '../../v1/contactComputation';

export const maxDuration = 300;

export async function GET(request) {
  const auth = verifyCron(request);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const contacts = await buildAllContacts(adminDb);

    let written = 0;
    let failed = 0;

    // Write in batches, catching per-batch errors
    const BATCH_SIZE = 500;
    for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
      const chunk = contacts.slice(i, i + BATCH_SIZE);
      try {
        await writeContacts(adminDb, chunk);
        written += chunk.length;
      } catch (err) {
        const keys = chunk.map((c) => c._key).join(', ');
        Sentry.captureException(err, {
          tags: { route: 'compute-contacts' },
          extra: { batchStart: i, contactKeys: keys },
        });
        console.error(`Failed to write contact batch starting at ${i}:`, err);
        failed += chunk.length;
      }
    }

    return NextResponse.json({
      success: true,
      totalContacts: contacts.length,
      written,
      failed,
    });
  } catch (err) {
    Sentry.captureException(err, { tags: { route: 'compute-contacts' } });
    console.error('Compute contacts cron error:', err);
    return NextResponse.json({ error: 'Failed to compute contacts' }, { status: 500 });
  }
}
