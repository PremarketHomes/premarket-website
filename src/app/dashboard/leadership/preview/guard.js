import { notFound } from 'next/navigation';

/** The sample-data preview routes exist everywhere except production, where they are a 404. */
export function assertNotProduction() {
  const env = process.env.VERCEL_ENV || (process.env.NODE_ENV === 'production' ? 'production' : 'development');
  if (env === 'production') notFound();
}
