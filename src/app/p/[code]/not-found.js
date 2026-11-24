import Link from 'next/link';

// Shown (with a 404) for a short link we don't know, or whose campaign has been deleted. Reveals nothing about either.
export default function ShortLinkNotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
      <div className="max-w-md text-center">
        <p className="text-lg font-bold text-orange-600 mb-7">Premarket</p>
        <h1 className="text-2xl font-bold text-slate-900 mb-3">This link isn’t working</h1>
        <p className="text-slate-600 leading-relaxed mb-7">
          The link may be mistyped, or the property is no longer available. Please check the link in your message, or ask
          the agent who sent it for a new one.
        </p>
        <Link href="/" className="inline-block bg-slate-900 text-white text-sm font-semibold px-5 py-3 rounded-xl">
          Go to premarket.homes
        </Link>
      </div>
    </main>
  );
}
