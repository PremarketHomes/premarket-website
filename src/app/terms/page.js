// pages/terms.js
import LegalPageShell from '../components/public-site/LegalPageShell';

export default function Terms() {
    return (
        <LegalPageShell title="Terms & Conditions">
                <div className="max-w-5xl mx-auto space-y-8">

                    {/* Table of Contents */}
                    <nav className="text-lg space-y-2 inter text-sm">
                        <ol className="list-decimal list-inside space-y-1 text-gray-600">
                            <li><a href="#1">1. Introduction & Definitions</a></li>
                            <li><a href="#2">2. Company Details (ABN, Legal Name)</a></li>
                            <li><a href="#3">3. What is Premarket?</a></li>
                            <li><a href="#4">4. Products & Services Overview</a></li>
                            <li><a href="#5">5. User Obligations & Data Accuracy</a></li>
                            <li><a href="#6">6. Company Commitments & Disclaimers</a></li>
                            <li><a href="#7">7. User Responsibilities</a></li>
                            <li><a href="#8">8. Intellectual Property & Copyright</a></li>
                            <li><a href="#9">9. How to Use Premarket</a></li>
                            <li><a href="#10">10. Payment & Third‑Party Processing</a></li>
                            <li><a href="#11">11. Affiliate & Third‑Party Referral Disclaimers</a></li>
                            <li><a href="#12">12. Limitation of Liability</a></li>
                            <li><a href="#13">13. Indemnification</a></li>
                            <li><a href="#14">14. Termination & Suspension</a></li>
                            <li><a href="#15">15. Governing Law & Jurisdiction</a></li>
                            <li><a href="#16">16. Changes to Terms</a></li>
                            <li><a href="#17">17. Contact Information</a></li>
                            <li><a href="#18">18. Platform Metrics, Scores &amp; Data Disclaimer</a></li>
                        </ol>
                    </nav>

                    {/* Sections placeholders */}
                    <section id="1" className="inter text-sm space-y-6 inter text-sm">
                        <h2 className="text-2xl font-interBold text-gray-900">1. Introduction &amp; Definitions</h2>

                        <div>
                            <h3 className="text-lg font-interBold text-gray-800 mb-2">1.1 Introduction</h3>
                            <p className="text-gray-700 leading-relaxed mb-4">
                                These Terms and Conditions ("Terms") govern your access to and use of the Premarket platform, products, and services (collectively, the "Platform") operated by Premarket Australia ("Premarket", "we", "us", or "our"). By accessing or using any part of the Platform, you agree to be bound by these Terms. If you do not agree with any part of these Terms, you must not access or use the Platform.
                            </p>
                            <p className="text-gray-700 leading-relaxed mb-4">
                                These Terms constitute a legal agreement between you and Premarket Australia. It is your responsibility to read them carefully before using the Platform. These Terms apply to all users, including but not limited to homeowners, property buyers, agents, and service providers.
                            </p>
                            <p className="text-gray-700 leading-relaxed">
                                Premarket is <span className="font-semibold">not</span> a licensed real estate agency, broker, or financial advisory service. We do not represent parties in property transactions and do not guarantee, warrant, or facilitate the actual sale of real estate. Our role is limited to providing a digital interface that facilitates connections between interested parties and optional third-party services.
                            </p>
                        </div>

                        <div>
                            <h3 className="text-lg font-interBold text-gray-800 mb-2">1.2 Definitions</h3>
                            <ul className="space-y-3 text-gray-700 leading-relaxed list-none pl-0">
                                <li>
                                    <span className="font-semibold">“Premarket”</span> refers to the platform developed and operated by Premarket Australia, including all associated websites, mobile applications, features, tools, and services.
                                </li>
                                <li>
                                    <span className="font-semibold">“Platform”</span> includes all digital interfaces provided by Premarket, including campaign tools, profile features, messaging functionality, and access to third-party referrals.
                                </li>
                                <li>
                                    <span className="font-semibold">“You” / “User”</span> refers to any individual or entity accessing or using the Platform, including homeowners, buyers, agents, and third-party service providers.
                                </li>
                                <li>
                                    <span className="font-semibold">“Homeowner”</span> means a user who registers a property on the Platform to gauge market interest, receive buyer signals, or initiate a campaign.
                                </li>
                                <li>
                                    <span className="font-semibold">“Buyer”</span> means a user expressing interest in a property through the Platform, submitting offers, or engaging in communications.
                                </li>
                                <li>
                                    <span className="font-semibold">“Agent”</span> refers to any real estate agent, agency, or representative using the Platform to provide estimates, insights, or connect with campaigns.
                                </li>
                                <li>
                                    <span className="font-semibold">“Third-Party Service Provider”</span> means any external entity or professional (e.g., mortgage brokers, conveyancers, property inspectors) whose services may be recommended, referenced, or linked to from the Platform. Premarket may act as an affiliate but does not control or guarantee these services.
                                </li>
                                <li>
                                    <span className="font-semibold">“Campaign”</span> refers to a time-bound digital marketing activity initiated by a homeowner on the Platform to test buyer interest in a property.
                                </li>
                                <li>
                                    <span className="font-semibold">“Premarket Edge”</span> is an optional service package offering homeowners access to pre-vetted third-party professionals and support tools to assist in formalising a property transaction.
                                </li>
                                <li>
                                    <span className="font-semibold">“Go to Market”</span> refers to a feature designed to assist homeowners who choose to move from an exploratory campaign to formal listing pathways, including agent connections and sale preparation tools.
                                </li>
                                <li>
                                    <span className="font-semibold">“Content”</span> includes all data, images, text, videos, documents, and information uploaded or shared via the Platform.
                                </li>
                                <li>
                                    <span className="font-semibold">“In-App Purchase”</span> refers to a paid feature or upgrade available within the Platform, which may be processed via third-party payment processors such as Stripe.
                                </li>
                                <li>
                                    <span className="font-semibold">“Agreement”</span> means these Terms, including any applicable policies or additional terms referenced or linked herein.
                                </li>
                            </ul>
                        </div>
                    </section>


                    <section id="2" className="inter text-sm space-y-6 inter text-sm">
                        <h2 className="text-2xl font-interBold text-gray-900">2. Company Details</h2>

                        <div className="text-gray-700 leading-relaxed space-y-4">
                            <p>
                                <span className="inter text-smBold">Legal Entity Name:</span> Premarket Australia Pty Ltd
                            </p>
                            <p>
                                <span className="inter text-smBold">ABN:</span> 62 685 776 943 (registered and active from 1 April 2025)
                            </p>
                            <p>
                                <span className="inter text-smBold">ACN:</span> 685 776 943
                            </p>
                            <p>
                                <span className="inter text-smBold">GST Status:</span> Registered for GST from 1 April 2025
                            </p>
                            <p>
                                <span className="inter text-smBold">Registered Office / Principal Place of Business:</span><br />
                                Kingscliff, New South Wales 2487, Australia
                            </p>
                            <p>
                                <span className="inter text-smBold">Contact Email:</span> knockknock@premarket.homes
                            </p>
                        </div>
                    </section>


                    <section id="3" className="inter text-sm font-inter space-y-6">
                        <h2 className="text-2xl font-interBold text-gray-900">3. What is Premarket?</h2>

                        <div className="text-gray-700 leading-relaxed space-y-4">
                            <p>
                                Premarket is a digital platform operated by <span className="font-semibold">Premarket Australia Pty Ltd</span> that enables homeowners, buyers, and agents to engage in early-stage property discovery and interest gathering. It allows homeowners to explore interest in their property before deciding whether to formally list it for sale.
                            </p>

                            <p>
                                The Platform offers tools that allow homeowners to initiate market test campaigns, connect with prospective buyers, and receive insights based on user activity and engagement. Buyers can browse active campaigns, express interest, and submit informal offers directly through the Platform.
                            </p>

                            <p>
                                Premarket is <span className="font-semibold">not a licensed real estate agency or broker</span>. We do not represent any party in a property transaction, do not facilitate sales, and do not guarantee any particular outcome, valuation, or sale result. Any expressions of interest, buyer activity, or agent engagement facilitated through the Platform are exploratory in nature and non-binding.
                            </p>

                            <p>
                                Our role is limited to the provision of technology that enables users to connect, share information, and assess market demand in an informal setting. Any formal legal, financial, or real estate decisions made as a result of interactions on the Platform are the sole responsibility of the users involved.
                            </p>

                            <p>
                                Premarket may refer or connect users with third-party professionals—such as conveyancers, mortgage brokers, or real estate agents—but does not control, operate, or warrant the services provided by those third parties.
                            </p>
                        </div>
                    </section>

                    <section id="4" className="inter text-sm font-inter space-y-6">
                        <h2 className="text-2xl font-interBold text-gray-900">4. Products &amp; Services Overview</h2>

                        <div className="text-gray-700 leading-relaxed space-y-4">
                            <p>
                                Premarket provides access to a range of digital products and services designed to help homeowners explore interest in their property and understand market dynamics before committing to a traditional listing process. All services are offered on a best-effort basis and are subject to availability, third-party performance, and user input.
                            </p>

                            <div className="space-y-2">
                                <h3 className="inter text-smBold text-lg text-gray-800">4.1 Campaigns</h3>
                                <p>
                                    Users may initiate a time-limited marketing campaign to test buyer interest in their property. These campaigns are hosted on the Platform and may include listing images, property descriptions, and engagement tools. Buyer interactions and expressions of interest during a campaign are informal and non-binding. Campaigns do not constitute formal listings and do not guarantee any specific outcomes.
                                </p>
                            </div>

                            <div className="space-y-2">
                                <h3 className="inter text-smBold text-lg text-gray-800">4.2 Premarket Edge</h3>
                                <p>
                                    Premarket Edge is an optional support service that provides access to a curated network of third-party professionals, including but not limited to conveyancers, mortgage brokers, title search providers, and contract preparation specialists. These services are provided by independent businesses. Premarket acts only as a connector and does not provide legal, financial, or property services itself.
                                </p>
                                <p>
                                    Users are responsible for reviewing and accepting the individual terms and conditions of any third-party provider engaged through Premarket Edge. Fees may apply and are disclosed prior to use.
                                </p>
                            </div>

                            <div className="space-y-2">
                                <h3 className="inter text-smBold text-lg text-gray-800">4.3 Go to Market</h3>
                                <p>
                                    The Go to Market feature assists homeowners who, after running a campaign, wish to proceed with a more formal property sale process. This may include connecting users to licensed real estate agents or service providers who can assist with listings, inspections, and transactions. Premarket does not facilitate or manage real estate sales, and we are not involved in negotiation, representation, or contractual agreements.
                                </p>
                            </div>
                        </div>
                    </section>

                    <section id="5" className="inter text-sm space-y-6">
                        <h2 className="text-2xl font-interBold text-gray-900">5. User Obligations &amp; Data Accuracy</h2>

                        <div className="text-gray-700 leading-relaxed space-y-4">
                            <p>
                                As a condition of using the Platform, all users agree to provide accurate, current, and complete information when creating accounts, listing properties, submitting offers, or interacting with other users and services. You are solely responsible for ensuring the integrity of any data or content you upload, submit, or share on the Platform.
                            </p>

                            <p>
                                Premarket does not independently verify property details, pricing expectations, user profiles, or any other data submitted by users. While we may provide automated suggestions or estimates, these are based on publicly available information, third-party sources, or internal algorithms, and are provided for general information purposes only.
                            </p>

                            <p>
                                You understand and acknowledge that:
                            </p>

                            <ul className="list-disc list-inside space-y-2">
                                <li>All property listings, images, descriptions, and engagement data originate from user submissions or publicly accessible records.</li>
                                <li>It is your responsibility to correct or update any information that becomes inaccurate or outdated.</li>
                                <li>You must not submit false, misleading, defamatory, or unlawful content of any kind.</li>
                                <li>You must not impersonate another person or entity or misrepresent your affiliation with Premarket or any third party.</li>
                            </ul>

                            <p>
                                Premarket reserves the right, at its sole discretion, to remove, hide, or restrict content that is found to be false, misleading, in breach of these Terms, or otherwise harmful to the user experience or integrity of the Platform. However, we make no commitment to monitor, moderate, or review user-submitted content on a regular basis.
                            </p>

                            <p>
                                You acknowledge that reliance on any data, estimates, buyer activity, or campaign performance metrics provided through the Platform is at your own risk. Such data is not intended to replace professional advice, valuation, or legal due diligence.
                            </p>
                        </div>
                    </section>

                    <section id="6" className="inter text-sm space-y-6">
                        <h2 className="text-2xl font-interBold text-gray-900">6. Company Commitments &amp; Disclaimers</h2>

                        <div className="text-gray-700 leading-relaxed space-y-4">
                            <p>
                                Premarket provides access to a platform designed to facilitate communication and information-sharing between homeowners, buyers, agents, and third-party service providers. While we strive to maintain a high-quality and reliable user experience, we make no guarantees regarding the outcomes, accuracy, or effectiveness of any content, connection, or service accessed via the Platform.
                            </p>

                            <p>
                                The following commitments are expressly <span className="font-semibold">not made</span> by Premarket:
                            </p>

                            <ul className="list-disc list-inside space-y-2">
                                <li>We do <span className="font-semibold">not</span> promise or guarantee the sale of any property listed on the Platform.</li>
                                <li>We do <span className="font-semibold">not</span> provide real estate, legal, or financial advice.</li>
                                <li>We do <span className="font-semibold">not</span> verify or endorse any offers made by buyers, or the legitimacy of users.</li>
                                <li>We do <span className="font-semibold">not</span> act as an intermediary or negotiator in any property transaction.</li>
                                <li>We do <span className="font-semibold">not</span> represent any party in any formal property sale or agreement.</li>
                            </ul>

                            <p>
                                Users are solely responsible for their own decisions, actions, and transactions based on information obtained via the Platform. Premarket shall not be liable for any direct, indirect, incidental, or consequential loss or damage arising from your use of the Platform, including reliance on data, estimates, or third-party services.
                            </p>

                            <p>
                                Any statements made on the Platform — including campaign performance, buyer demand indicators, or agent feedback — are intended for informational purposes only. They should not be interpreted as predictions, guarantees, or representations of market value or sale potential.
                            </p>

                            <p>
                                Premarket reserves the right to modify, suspend, or discontinue any part of the Platform at any time without notice and without liability.
                            </p>
                        </div>
                    </section>

                    <section id="7" className="inter text-sm space-y-6">
                        <h2 className="text-2xl font-interBold text-gray-900">7. User Responsibilities</h2>

                        <div className="text-gray-700 leading-relaxed space-y-4">
                            <p>
                                By using the Platform, you agree to conduct yourself in a lawful, respectful, and transparent manner. You acknowledge that your access to and use of Premarket is conditional upon compliance with these Terms, and that your continued use signifies your ongoing agreement to abide by them.
                            </p>

                            <p>You are solely responsible for the following:</p>

                            <ul className="list-disc list-inside space-y-2">
                                <li>
                                    Ensuring that any property details, personal information, and communication submitted through the Platform are accurate, honest, and free from misleading claims.
                                </li>
                                <li>
                                    Acting in good faith when expressing interest, submitting offers, or responding to inquiries — whether as a homeowner, buyer, or agent.
                                </li>
                                <li>
                                    Respecting the privacy and confidentiality of other users, and not using the Platform to solicit, harass, mislead, or spam individuals or businesses.
                                </li>
                                <li>
                                    Notifying Premarket promptly if you become aware of fraudulent activity, false listings, or breaches of these Terms by any other user.
                                </li>
                                <li>
                                    Complying with any applicable local laws and regulations, including but not limited to property, consumer, tax, and anti-discrimination laws.
                                </li>
                            </ul>

                            <p>
                                You acknowledge that Premarket is a neutral platform designed to facilitate early-stage discovery, and that it is your personal responsibility to verify any data, pursue due diligence, and engage with licensed professionals when considering or participating in a transaction.
                            </p>

                            <p>
                                Premarket may, at its sole discretion, restrict, suspend, or terminate your access to the Platform if you are found to be in breach of these responsibilities or if your conduct is deemed harmful to the platform or its users.
                            </p>
                        </div>
                    </section>

                    <section id="8" className="inter text-sm space-y-6">
                        <h2 className="text-2xl font-interBold text-gray-900">8. Intellectual Property &amp; Copyright</h2>

                        <div className="text-gray-700 leading-relaxed space-y-4">
                            <p>
                                All intellectual property rights in and to the Platform, including but not limited to software code, branding, visual design, layout, trademarks, service marks, logos, icons, text, images, videos, databases, algorithms, and any content created or provided by Premarket, are and remain the exclusive property of <span className="font-semibold">Premarket Australia Pty Ltd</span>, unless otherwise explicitly stated.
                            </p>

                            <p>
                                Users are granted a limited, non-exclusive, non-transferable, and revocable license to access and use the Platform for its intended purpose in accordance with these Terms. This license does not include any rights to:
                            </p>

                            <p>
                                By uploading or submitting any content to the Platform — including but not limited to property images, videos, documents, written descriptions, or messages — you confirm that you are the rightful owner of that content or have obtained all necessary rights, licenses, or permissions from the rightful owner to use and share that content on Premarket.
                            </p>

                            <p>
                                You also grant Premarket Australia Pty Ltd an irrevocable, worldwide, royalty-free, perpetual license to use, display, reproduce, modify, distribute, and publish this content in any form or channel we choose — including but not limited to marketing, advertising, social media, commercial use, or platform improvements — without any further notice, approval, or compensation.
                            </p>

                            <p>
                                You acknowledge that Premarket may use uploaded content for the purpose of promoting the Platform, demonstrating user engagement, or showcasing properties, and you waive any claims relating to moral rights, attribution, or control over how that content is used once submitted.
                            </p>

                            <ul className="list-disc list-inside space-y-2">
                                <li>Modify, copy, reproduce, distribute, publish, or create derivative works from any part of the Platform or its content.</li>
                                <li>Use Premarket branding, trademarks, or visual assets without express written permission.</li>
                                <li>Scrape, crawl, or extract data from the Platform for commercial purposes without prior authorisation.</li>
                                <li>Republish or redistribute any part of the Platform or its services without explicit written consent.</li>
                            </ul>

                            <p>
                                Content uploaded by users, including property listings, images, messages, or feedback, remains the intellectual property of the respective user. However, by uploading or submitting content to the Platform, you grant Premarket a non-exclusive, royalty-free, worldwide license to use, display, reproduce, adapt, and distribute such content as necessary to operate, promote, or improve the Platform.
                            </p>

                            <p>
                                Premarket respects the intellectual property rights of others and expects users to do the same. If you believe that your copyrighted work has been copied, used, or displayed on the Platform in a way that constitutes infringement, please contact us immediately at <a href="mailto:knockknock@premarket.homes" className="text-[#e48900] hover:underline">knockknock@premarket.homes</a> with detailed information so we can investigate and take appropriate action.
                            </p>
                        </div>
                    </section>

                    <section id="9" className="inter text-sm space-y-6">
                        <h2 className="text-2xl font-interBold text-gray-900">9. How to Use Premarket</h2>

                        <div className="text-gray-700 leading-relaxed space-y-4">
                            <p>
                                Premarket is designed to support early-stage property discovery and interest validation by connecting homeowners, buyers, and agents through a neutral, technology-driven interface. The Platform is not intended to replace formal real estate processes, nor does it act as an agent or intermediary in any property transaction.
                            </p>

                            <div className="space-y-2">
                                <h3 className="inter text-smBold text-lg text-gray-800">9.1 Homeowners</h3>
                                <p>
                                    Homeowners can create a campaign to test buyer interest before formally going to market. You may upload images, provide property details, set price expectations, and interact with potential buyers. You remain in full control of your campaign at all times and are under no obligation to sell, respond, or negotiate with any party.
                                </p>
                                <p>
                                    You must ensure that any property you list is owned by you, or that you have appropriate authority to list and manage the campaign on behalf of the owner. You must also ensure the information you provide is accurate and not misleading.
                                </p>
                            </div>

                            <div className="space-y-2">
                                <h3 className="inter text-smBold text-lg text-gray-800">9.2 Buyers</h3>
                                <p>
                                    Buyers can browse properties, express interest, save favourites, and submit informal offers through the Platform. All interactions are exploratory and non-binding. Expressing interest in a property does not constitute a formal offer or contractual obligation.
                                </p>
                                <p>
                                    Buyers are responsible for conducting their own research and due diligence. Premarket does not verify the accuracy of property listings, ownership, or title status.
                                </p>
                            </div>

                            <div className="space-y-2">
                                <h3 className="inter text-smBold text-lg text-gray-800">9.3 Agents</h3>
                                <p>
                                    Agents may participate by providing property estimates, market insights, or assisting homeowners who choose to transition to a formal sales campaign. Agents are not employed or contracted by Premarket and must hold valid real estate licenses as required by their jurisdiction.
                                </p>
                                <p>
                                    Participation as an agent is at Premarket’s discretion. We may remove or restrict agent access at any time if found to be acting inappropriately, breaching ethical guidelines, or misrepresenting qualifications.
                                </p>
                            </div>

                            <p>
                                All users must use the Platform in accordance with these Terms and applicable laws. Misuse of features, abuse of communication channels, or the uploading of false or harmful information may result in immediate suspension or termination of your access.
                            </p>
                        </div>
                    </section>

                    <section id="10" className="inter text-sm space-y-6">
                        <h2 className="text-2xl font-interBold text-gray-900">10. Payment &amp; Third-Party Processing</h2>

                        <div className="text-gray-700 leading-relaxed space-y-4">
                            <p>
                                Some features and services offered through the Premarket Platform may require payment. All paid features will be clearly marked, and users will be provided with pricing information before any charges are applied. By choosing to use a paid feature or service, you agree to pay the associated fees and abide by the applicable billing terms.
                            </p>

                            <p>
                                Payments made through the Platform are securely processed by third-party payment providers, such as <span className="font-semibold">Stripe</span>, and may also include in-app payment gateways. Premarket does not directly store or handle your credit card information, and all payment details are subject to the terms and privacy policies of the applicable payment provider.
                            </p>

                            <p>
                                You are responsible for ensuring that your payment method is valid and that sufficient funds or credit are available to cover any charges. In the event of a failed or declined transaction, we may suspend or limit access to the relevant feature until payment is resolved.
                            </p>

                            <p>
                                All purchases are final unless otherwise stated. Refunds may be granted at our sole discretion and only in exceptional circumstances. If you believe you have been charged in error, please contact <a href="mailto:knockknock@premarket.homes" className="text-[#e48900] hover:underline">knockknock@premarket.homes</a> within 7 days of the transaction for review.
                            </p>

                            <p>
                                Premarket is not responsible for delays, errors, or interruptions in payment processing caused by third-party platforms or service providers. Your use of these services is governed by their respective terms and conditions, and you acknowledge that disputes or chargebacks may require engagement with the payment processor directly.
                            </p>

                            <p>
                                Prices for services or features offered on the Platform are subject to change at any time without prior notice. Continued use of the Platform following a price change constitutes your acceptance of the updated pricing.
                            </p>
                        </div>
                    </section>

                    <section id="11" className="inter text-sm space-y-6">
                        <h2 className="text-2xl font-interBold text-gray-900">11. Affiliate &amp; Third-Party Referral Disclaimers</h2>

                        <div className="text-gray-700 leading-relaxed space-y-4">
                            <p>
                                Premarket may refer or connect users to third-party service providers, including but not limited to conveyancers, mortgage brokers, building inspectors, agents, removalists, or document specialists. These referrals are provided for user convenience and do not constitute an endorsement, recommendation, or guarantee of service quality or availability.
                            </p>

                            <p>
                                These third parties operate independently of Premarket. Any interactions, transactions, or engagements between you and a referred third-party provider are conducted entirely at your own risk and discretion. You are responsible for reviewing their terms, verifying credentials, and making any necessary inquiries before proceeding.
                            </p>

                            <p>
                                Premarket does not control, supervise, or warrant the services, accuracy, pricing, reliability, legality, or conduct of any third-party provider. We accept no responsibility for any acts, omissions, damages, losses, or disputes that arise out of your engagement with third-party services.
                            </p>

                            <p>
                                From time to time, Premarket may receive commissions, referral fees, or other forms of compensation from third-party providers in connection with services referred through the Platform. By using these services, you acknowledge and consent to this potential commercial relationship.
                            </p>

                            <p>
                                You agree that any issues, disputes, or claims relating to third-party services must be addressed directly with the provider in question. Premarket will not act as an intermediary, negotiator, or dispute resolution body between users and third-party vendors.
                            </p>
                        </div>
                    </section>

                    <section id="12" className="inter text-sm space-y-6">
                        <h2 className="text-2xl font-interBold text-gray-900">12. Limitation of Liability</h2>

                        <div className="text-gray-700 leading-relaxed space-y-4">
                            <p>
                                To the fullest extent permitted by law, Premarket Australia Pty Ltd, including its directors, employees, contractors, affiliates, and representatives, shall not be liable to you or any third party for any loss, damage, or liability (whether direct, indirect, incidental, special, punitive, or consequential) arising out of or in connection with your access to or use of the Platform, its features, or any third-party services accessed through it.
                            </p>

                            <p>
                                This includes, but is not limited to, liability for:
                            </p>

                            <ul className="list-disc list-inside space-y-2">
                                <li>Loss of profits, revenue, business, or opportunity</li>
                                <li>Loss or corruption of data or content</li>
                                <li>Missed opportunities regarding the sale of a property</li>
                                <li>Missed or lost revenue regarding the sale of a property</li>
                                <li>Delays or interruptions in service</li>
                                <li>Failure to secure a buyer or complete a property transaction</li>
                                <li>Any reliance placed on campaign results, insights, estimates, or user engagement metrics</li>
                                <li>Acts or omissions of referred or third-party service providers</li>
                            </ul>

                            <p>
                                You acknowledge that Premarket is not a licensed real estate agency or broker and that we do not facilitate, represent, or guarantee any aspect of a property sale. You use the Platform at your own risk and are solely responsible for evaluating the accuracy, completeness, or usefulness of any data, interaction, or service made available.
                            </p>

                            <p>
                                Where liability cannot be excluded under applicable law, including under the <span className="italic">Australian Consumer Law</span>, our liability is limited to, at our sole discretion:
                            </p>

                            <ul className="list-disc list-inside space-y-2">
                                <li>The resupply of the relevant services; or</li>
                                <li>The payment of the cost of having the services supplied again</li>
                            </ul>

                            <p>
                                In no event shall our total aggregate liability exceed the amount paid by you (if any) for access to the paid feature or service that directly gave rise to the claim.
                            </p>

                            <p>
                                This limitation of liability applies regardless of the legal theory under which the claim is brought, including but not limited to contract, tort (including negligence), statutory duty, or otherwise.
                            </p>
                        </div>
                    </section>

                    <section id="14" className="inter text-sm space-y-6">
                        <h2 className="text-2xl font-interBold text-gray-900">14. Termination &amp; Suspension</h2>

                        <div className="text-gray-700 leading-relaxed space-y-4">
                            <p>
                                Premarket Australia Pty Ltd reserves the right to suspend, restrict, or permanently terminate your access to the Platform — in full or in part — at any time, with or without notice, if we determine, at our sole discretion, that:
                            </p>

                            <ul className="list-disc list-inside space-y-2">
                                <li>You have violated these Terms or any applicable law</li>
                                <li>Your conduct presents a risk to other users, third parties, or the integrity of the Platform</li>
                                <li>Your account is suspected of fraud, abuse, harassment, or misleading activity</li>
                                <li>You have failed to pay for any paid features or services when due</li>
                                <li>You have submitted false, offensive, or unlawful content</li>
                            </ul>

                            <p>
                                Suspension or termination may include the removal or hiding of your profile, listings, content, campaigns, or offers without liability to you. Any such decision is final and not subject to appeal unless otherwise required by law.
                            </p>

                            <p>
                                In the event of termination, your right to use the Platform will immediately cease. Any obligations or liabilities that accrued prior to termination — including indemnification, payment obligations, and legal responsibilities — will continue to apply.
                            </p>

                            <p>
                                Premarket is not required to retain or export any data, content, or communications associated with a terminated account. We recommend you keep local copies of any important content prior to account closure.
                            </p>

                            <p>
                                You may choose to cancel your account at any time by contacting us at <a href="mailto:knockknock@premarket.homes" className="text-[#e48900] hover:underline">knockknock@premarket.homes</a>. Account deletion is permanent and cannot be reversed.
                            </p>
                        </div>
                    </section>

                    <section id="15" className="font-inter space-y-6">
                        <h2 className="text-2xl font-interBold text-gray-900">15. Governing Law &amp; Jurisdiction</h2>

                        <div className="text-gray-700 leading-relaxed space-y-4">
                            <p>
                                These Terms, and any dispute, controversy, proceeding, or claim of whatever nature arising out of or in any way relating to the Platform or its use (including any non-contractual disputes or claims), shall be governed by and construed in accordance with the laws of the <span className="font-semibold">State of New South Wales, Australia</span>.
                            </p>

                            <p>
                                You irrevocably agree that the courts of New South Wales — and where applicable, the Federal Court of Australia — shall have exclusive jurisdiction to settle any dispute or claim arising out of or in connection with these Terms, your use of the Platform, or any services provided by Premarket Australia Pty Ltd.
                            </p>

                            <p>
                                You waive any objection to the exercise of jurisdiction by such courts on the grounds that it is an inconvenient forum or that proceedings have been brought in an improper venue.
                            </p>

                            <p>
                                If any provision of these Terms is held to be invalid, illegal, or unenforceable under applicable law, that provision will be deemed modified to the minimum extent necessary to make it enforceable, and the remaining provisions will remain in full force and effect.
                            </p>
                        </div>
                    </section>

                    <section id="16" className="font-inter space-y-6">
                        <h2 className="text-2xl font-interBold text-gray-900">16. Changes to Terms</h2>

                        <div className="text-gray-700 leading-relaxed space-y-4">
                            <p>
                                Premarket Australia Pty Ltd reserves the right to modify, update, or replace these Terms at any time, in whole or in part, at our sole discretion. Changes may be made to reflect updates in our business practices, legal obligations, user feedback, service offerings, or platform features.
                            </p>

                            <p>
                                When changes are made, we will revise the “Last Updated” date at the top of this document and may provide notice through the Platform, via email, or other appropriate means. It is your responsibility to review the Terms regularly to stay informed of any updates.
                            </p>

                            <p>
                                Continued use of the Platform after the effective date of any changes constitutes your acceptance of the revised Terms. If you do not agree to the updated Terms, you must discontinue use of the Platform immediately and, where applicable, close your account.
                            </p>

                            <p>
                                Premarket is not liable for any loss or damage resulting from your failure to read or understand any changes to the Terms. We recommend bookmarking this page and reviewing it periodically to remain aware of your rights and obligations.
                            </p>
                        </div>
                    </section>

                    <section id="18" className="inter text-sm space-y-6">
                        <h2 className="text-2xl font-interBold text-gray-900">18. Platform Metrics, Scores &amp; Data Disclaimer</h2>

                        <div className="text-gray-700 leading-relaxed space-y-4">
                            <p>
                                The Premarket Platform displays a range of proprietary metrics, scores, indicators, and data visualisations &mdash; including but not limited to buyer demand scores, market health indicators, suburb-level trend analysis, price opinion aggregations, competition indices, forecast projections, engagement scores, and any other numerical, graphical, or text-based data outputs generated by the Platform (collectively, <span className="font-semibold">&ldquo;Platform Metrics&rdquo;</span>).
                            </p>

                            <div className="space-y-2">
                                <h3 className="inter text-smBold text-lg text-gray-800">18.1 Proprietary Calculations</h3>
                                <p>
                                    All Platform Metrics are the result of Premarket&rsquo;s own proprietary calculations, formulas, algorithms, and methodologies developed internally by Premarket Australia Pty Ltd. These calculations are based on data collected and aggregated from user activity on the Platform, including but not limited to buyer engagement, price opinions submitted by users, property listing activity, user interactions, and other behavioural signals captured through the Platform.
                                </p>
                                <p>
                                    Platform Metrics do <span className="font-semibold">not</span> incorporate or rely upon licensed property valuation data, government-certified appraisals, registered valuer assessments, or any other externally audited or independently verified data source unless explicitly stated otherwise.
                                </p>
                            </div>

                            <div className="space-y-2">
                                <h3 className="inter text-smBold text-lg text-gray-800">18.2 Opinions, Not Professional Valuations</h3>
                                <p>
                                    Platform Metrics represent <span className="font-semibold">Premarket&rsquo;s own opinions and interpretations</span> of the data we collect. They are <span className="font-semibold">not</span> formal property valuations, certified appraisals, sworn valuations, professional advice, or financial recommendations of any kind. They should not be treated as, or relied upon as if they were, independent or professional assessments of property value, market conditions, or investment potential.
                                </p>
                                <p>
                                    Price opinions displayed on the Platform are submitted by individual users and reflect the personal, subjective views of those individuals. Premarket aggregates and presents this data for informational and illustrative purposes only. The aggregation of user-submitted opinions does not transform those opinions into a professional valuation, market appraisal, or reliable indicator of actual market value.
                                </p>
                            </div>

                            <div className="space-y-2">
                                <h3 className="inter text-smBold text-lg text-gray-800">18.3 No Guarantee of Accuracy, Completeness, or Reliability</h3>
                                <p>
                                    Premarket makes <span className="font-semibold">no representation or warranty</span>, whether express, implied, or statutory, regarding the accuracy, completeness, reliability, timeliness, suitability, or fitness for any particular purpose of any Platform Metric. Platform Metrics may contain errors, omissions, or inaccuracies. They may be based on limited, incomplete, or unverified data. They may fluctuate, change, or be recalculated at any time without notice.
                                </p>
                                <p>
                                    Platform Metrics are generated algorithmically and may be influenced by a range of factors including the volume of user activity, the geographic spread of data, the time period over which data is collected, and the inherent biases or limitations of user-submitted information. Premarket does not guarantee that any score, metric, or indicator will remain consistent, predictable, or comparable across different properties, suburbs, time periods, or user groups.
                                </p>
                            </div>

                            <div className="space-y-2">
                                <h3 className="inter text-smBold text-lg text-gray-800">18.4 Not Financial, Legal, or Investment Advice</h3>
                                <p>
                                    Nothing displayed on the Platform &mdash; including Platform Metrics, price opinion summaries, demand indicators, trend charts, suburb comparisons, forecasts, or any other data outputs &mdash; constitutes financial advice, investment advice, legal advice, tax advice, or real estate advice. You must not rely on any Platform Metric as a basis for making financial, investment, property, or legal decisions.
                                </p>
                                <p>
                                    Before making any decision relating to the purchase, sale, listing, pricing, financing, or investment in real property, you should seek independent professional advice from appropriately qualified and licensed professionals, including but not limited to registered property valuers, licensed real estate agents, financial advisers, solicitors, conveyancers, and accountants. Premarket is not a substitute for professional guidance and does not hold any licences, accreditations, or certifications that would qualify it to provide such advice.
                                </p>
                            </div>

                            <div className="space-y-2">
                                <h3 className="inter text-smBold text-lg text-gray-800">18.5 Assumption of Risk</h3>
                                <p>
                                    By accessing, viewing, or using any Platform Metric, you expressly acknowledge and agree that:
                                </p>
                                <ul className="list-disc list-inside space-y-2">
                                    <li>You do so <span className="font-semibold">entirely at your own risk</span>.</li>
                                    <li>You understand that Platform Metrics are proprietary opinions derived from Premarket&rsquo;s own internal data and algorithms, and not independent or professionally verified assessments.</li>
                                    <li>You will <span className="font-semibold">not</span> rely solely on any Platform Metric when making any financial, property, investment, or legal decision.</li>
                                    <li>You accept <span className="font-semibold">full and sole responsibility</span> for any decisions, actions, or omissions you make based on, influenced by, or connected to information obtained from the Platform.</li>
                                    <li>You will conduct your own independent research and due diligence and seek appropriate professional advice before acting on any information provided by the Platform.</li>
                                </ul>
                            </div>

                            <div className="space-y-2">
                                <h3 className="inter text-smBold text-lg text-gray-800">18.6 No Liability for Decisions or Outcomes</h3>
                                <p>
                                    To the maximum extent permitted by law, Premarket Australia Pty Ltd, its directors, officers, employees, contractors, agents, and affiliates accept <span className="font-semibold">no responsibility or liability whatsoever</span> for any loss, damage, cost, expense, claim, or liability (whether direct, indirect, consequential, incidental, special, punitive, or otherwise) that you or any third party may suffer or incur as a result of, or in connection with:
                                </p>
                                <ul className="list-disc list-inside space-y-2">
                                    <li>Any decision to buy, sell, list, hold, price, finance, or otherwise deal with real property based in whole or in part on any Platform Metric or information displayed on the Platform.</li>
                                    <li>Any decision to enter into, withdraw from, or decline a property transaction, negotiation, or agreement based on Platform data.</li>
                                    <li>Any financial loss, opportunity cost, loss of profit, diminution in property value, or adverse outcome arising from reliance on Platform Metrics.</li>
                                    <li>Any difference between a Platform Metric (including aggregated price opinions, demand scores, or forecasts) and the actual sale price, market value, or professional valuation of a property.</li>
                                    <li>Any act or omission taken or not taken as a consequence of viewing, interpreting, or relying upon any data presented on the Platform.</li>
                                    <li>Any inaccuracy, error, omission, delay, or change in any Platform Metric.</li>
                                </ul>
                                <p>
                                    You irrevocably release and hold harmless Premarket Australia Pty Ltd from any and all claims, demands, actions, suits, or proceedings arising out of or related to your use of or reliance on Platform Metrics. This release applies regardless of whether the loss or damage was foreseeable, and regardless of whether Premarket was advised or ought to have been aware of the possibility of such loss or damage.
                                </p>
                            </div>

                            <div className="space-y-2">
                                <h3 className="inter text-smBold text-lg text-gray-800">18.7 Changes to Metrics and Methodologies</h3>
                                <p>
                                    Premarket reserves the right to modify, recalibrate, replace, suspend, or discontinue any Platform Metric, scoring methodology, algorithm, data source, or calculation at any time and without prior notice. Historical data and scores may be recalculated or removed. Premarket is under no obligation to maintain consistency in its scoring systems, to disclose the specifics of its proprietary methodologies, or to notify users of changes to the way Platform Metrics are generated or displayed.
                                </p>
                            </div>

                            <div className="space-y-2">
                                <h3 className="inter text-smBold text-lg text-gray-800">18.8 Relationship With Other Sections</h3>
                                <p>
                                    This section supplements and operates in addition to &mdash; not in replacement of &mdash; Section 6 (Company Commitments &amp; Disclaimers), Section 12 (Limitation of Liability), and Section 13 (Indemnification) of these Terms. In the event of any conflict, the provision that provides the broadest protection to Premarket Australia Pty Ltd shall prevail.
                                </p>
                            </div>
                        </div>
                    </section>







                </div>
        </LegalPageShell>
    );
}
