// Note: previously declared a Google Sitelinks SearchAction pointing at
// /find-property?search={term} — removed as part of the release audit.
// That declaration told Google this site is a searchable property
// marketplace, which contradicts the agent-led, link-distributed
// positioning the redesigned public site now describes. Premarket has
// no public search UI at that URL to back the claim.
export default function SchemaWebsite() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": "Premarket",
    "url": "https://premarket.homes"
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
