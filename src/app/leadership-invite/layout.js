// The invitation URL carries a secret token: keep it out of search results and out of Referer headers.
export const metadata = {
  title: 'Leadership Hub invitation | Premarket',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export default function Layout({ children }) { return children; }
