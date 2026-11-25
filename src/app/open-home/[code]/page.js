import OpenHomeVisitClient from './OpenHomeVisitClient';

// Public (no login): a buyer's phone, from the QR code at an Open Home pilot session.
export default async function OpenHomeVisitPage({ params }) {
  const { code } = await params;
  return <OpenHomeVisitClient code={code} />;
}
