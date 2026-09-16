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
// Rewritten in the release audit — the previous copy described Premarket
// as a browsable public listings platform ("browse pre-market property
// listings... across Australia"), which contradicts the agent-led,
// link-distributed positioning the redesigned site now describes.
const buyerFAQs = [
  {
    question: "What is Premarket and how does it work?",
    answer: "Premarket is how real estate agents share a property with the buyers already in their own database. An agent sends a direct link, and the buyer can share an anonymous price opinion or register genuine interest — no account required."
  },
  {
    question: "Do I need an account to share a price opinion?",
    answer: "No. Anyone with a property link from their agent can share a price opinion or register interest without creating an account. Buyers who want to keep track of what they've been sent can optionally create a free account."
  },
  {
    question: "What are buyer price opinions?",
    answer: "Buyer price opinions are anonymous submissions from real people sharing what they think a property is worth. Unlike algorithm-generated estimates, these are genuine opinions from actual buyers, giving the agent and vendor real evidence before a campaign launches."
  },
  {
    question: "How is Premarket different from other property sites?",
    answer: "Premarket isn't a property portal you browse. Properties are shared privately by an agent with their own buyers — the value is in the real, anonymous buyer evidence a campaign generates, not in public listings or algorithmic estimates."
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
