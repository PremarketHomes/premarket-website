import { NextResponse } from 'next/server';
import { verifyAuth } from '../middleware/auth';
import { bunnyUploadUrl, cdnUrlFor } from '../services/storageConfig';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'];

export async function POST(request) {
  try {
    const auth = await verifyAuth(request);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 400 });
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Invalid file type. Allowed: JPEG, PNG, WebP, AVIF, GIF' }, { status: 400 });
    }

    const accessKey = process.env.BUNNY_STORAGE_ACCESS_KEY;
    if (!accessKey) {
      return NextResponse.json({ error: 'Storage not configured' }, { status: 500 });
    }

    const filename = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '')}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const response = await fetch(
      bunnyUploadUrl(filename),
      {
        method: 'PUT',
        headers: {
          'AccessKey': accessKey,
          'Content-Type': file.type || 'application/octet-stream',
        },
        body: buffer,
      }
    );

    if (!response.ok) {
      const text = await response.text();
      console.error('Bunny upload failed:', text);
      return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
    }

    const cdnUrl = cdnUrlFor(filename);
    return NextResponse.json({ url: cdnUrl });
  } catch (err) {
    console.error('Upload error:', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
