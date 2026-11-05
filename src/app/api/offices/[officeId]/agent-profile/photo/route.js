import { NextResponse } from 'next/server';
import { verifyAuth } from '../../../../middleware/auth';
import { requireOfficeAdmin } from '../../../../services/officeService';
import { resolveDirectoryRow, sniffImageType } from '../../../../services/officeAgentService';

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * POST /api/offices/{officeId}/agent-profile/photo   (multipart: key, file)
 * Office-admin only. Verifies the agent belongs to THIS office, then validates the file by its actual
 * bytes (JPEG/PNG/WebP, max 5MB) and stores it with the existing CDN storage. Returns { url }; the
 * caller then saves it via PATCH. Uploading never touches the agent's login.
 */
export async function POST(request, { params }) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const { officeId } = await params;
    await requireOfficeAdmin({ officeId, uid: auth.uid });

    const form = await request.formData();
    const key = form.get('key');
    const file = form.get('file');
    if (typeof key !== 'string' || !file || typeof file === 'string') {
      return NextResponse.json({ error: 'Agent and photo are required' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Photo too large (max 5MB)' }, { status: 400 });
    await resolveDirectoryRow(officeId, key);

    const buffer = Buffer.from(await file.arrayBuffer());
    const type = sniffImageType(buffer);
    if (!type) return NextResponse.json({ error: 'Photo must be a JPEG, PNG or WebP image' }, { status: 400 });

    const accessKey = process.env.BUNNY_STORAGE_ACCESS_KEY;
    if (!accessKey) return NextResponse.json({ error: 'Storage not configured' }, { status: 500 });
    const filename = `office-agents/${officeId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${type.ext}`;
    const res = await fetch(`https://syd.storage.bunnycdn.com/premarketvideos/${filename}`, {
      method: 'PUT',
      headers: { AccessKey: accessKey, 'Content-Type': type.mime },
      body: buffer,
    });
    if (!res.ok) return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
    return NextResponse.json({ url: `https://premarketvideos.b-cdn.net/${filename}` });
  } catch (err) {
    console.error('Office agent photo error:', err);
    return NextResponse.json({ error: err.message || 'Upload failed' }, { status: err.status || 500 });
  }
}
