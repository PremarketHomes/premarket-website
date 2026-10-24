// The activation URL carries a secret token: keep it out of search results and
// out of Referer headers sent to other sites.
export const metadata = {
  title: 'Set up your Premarket account',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function ActivateLayout({ children }) {
  return children;
}
