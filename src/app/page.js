// app/page.js - Public Homepage
// PROTOTYPE BRANCH: homepage body swapped for the visual-concept prototype
// (HomepageStoryPrototype). Nothing else on this page — metadata, schema,
// FAQ markup — has been changed. Not intended to be merged as-is; see
// src/app/components/homepage-prototype/ for the isolated prototype code.
import HomepageStoryPrototype from './components/homepage-prototype/HomepageStoryPrototype';
import SchemaOrganization from './components/SchemaOrganization';
import SchemaWebsite from './components/SchemaWebsite';

export const metadata = {
  title: "Premarket - Validate Property Prices with Real Buyer Feedback",
  description: "Premarket lets agents and homeowners validate property prices with real buyer feedback\u2014before or during a live listing\u2014so you attract stronger interest, build trust, and sell with confidence.",
  keywords: "property price validation, buyer price opinions, real estate listings, property listings australia, premarket homes, property prices, real estate australia, buyer feedback",
  openGraph: {
    title: "Premarket - Validate Property Prices with Real Buyer Feedback",
    description: "Premarket lets agents and homeowners validate property prices with real buyer feedback\u2014before or during a live listing\u2014so you attract stronger interest, build trust, and sell with confidence.",
    url: 'https://premarket.homes',
    siteName: 'Premarket',
    images: [
      {
        url: 'https://premarket.homes/assets/og-image-agents.jpg',
        width: 1200,
        height: 630,
        alt: 'Premarket - Pre-Market Properties with Real Buyer Data',
      },
    ],
    locale: 'en_AU',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Premarket - Validate Property Prices with Real Buyer Feedback',
    description: 'Premarket lets agents and homeowners validate property prices with real buyer feedback\u2014before or during a live listing\u2014so you attract stronger interest, build trust, and sell with confidence.',
    images: ['https://premarket.homes/assets/twitter-image-agents.jpg'],
  },
  alternates: {
    canonical: 'https://premarket.homes',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
};

// FAQ data for Schema markup - Buyer/Public focused
const buyerFAQs = [
  {
    question: "What is Premarket and how does it work?",
    answer: "Premarket is a free platform where you can browse pre-market property listings from verified agents across Australia. You can share your price opinion on any property — telling agents what you think it's worth — and register interest to stay informed. It's completely anonymous and zero obligation."
  },
  {
    question: "Is it free to browse and share my price opinion?",
    answer: "Yes — Premarket is 100% free for buyers and browsers. There are no fees, no sign-up required to browse, and no obligation whatsoever. You can share your price opinion on any property without creating an account."
  },
  {
    question: "What are buyer price opinions?",
    answer: "Buyer price opinions are anonymous submissions from real people sharing what they think a property is worth. Unlike algorithm-generated estimates, these are genuine opinions from actual buyers in the market, giving a more accurate picture of real demand."
  },
  {
    question: "How is Premarket different from other property sites?",
    answer: "Traditional property sites show listings with asking prices set by agents. Premarket shows properties with real buyer price data instead of algorithmic estimates — whether they're pre-market or already listed. You see what buyers actually think a property is worth, not what an algorithm predicts."
  }
];

export default function Home() {
  return (
    <>
      {/* Schema Markup for SEO */}
      <SchemaOrganization />
      <SchemaWebsite />

      {/* Buyer-focused FAQ Schema */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": buyerFAQs.map(faq => ({
              "@type": "Question",
              "name": faq.question,
              "acceptedAnswer": {
                "@type": "Answer",
                "text": faq.answer
              }
            }))
          })
        }}
      />

      <main>
        <HomepageStoryPrototype />
      </main>
    </>
  );
}
