import Link from 'next/link';

export default function CallToAction() {
  return (
    <section className="bg-gray-900 py-16">
      <div className="container mx-auto px-4 text-center text-white">
        <h2 className="text-5xl font-bold mb-4">Campaign Finished?</h2>
        <p className="mb-6 text-xl">At the end of your campaign you'll have 3 choices.</p>

        <div className="flex flex-col md:flex-row justify-center">
          {/* Card 1 */}
           <Link href="/" className='w-full md:w-1/3'>
          <div className="border-2 my-4 sm:border-r-0 border-white rounded-lg sm:rounded-r-none ">
            <div className="card-inner flex flex-col items-center">
              <img src="/assets/icon1.png" alt="Extend Campaign" className="w-16 mt-10 h-16 mb-4 rounded" />
              <h3 className="text-5xl font-bold mb-2">Keep it going</h3>
              <h3 className="text-2xl font-bold mb-2">Extend your Campaign</h3>
              <p className="mb-4 text-sm leading-tight">
                For $49 per month you can extend your campaign into the future. You'll continue to receive offers and campaign reports.
              </p>
            </div>
          </div>
          </Link>

          {/* Card 2 */}
          <Link href="/edge" className='w-full md:w-1/3'>
          <div className="rainbow-border">
            <div className="card-inner2 text-gray-900 py-20 px-10">
               <img src="/assets/icon2.png" alt="Extend Campaign" className="mx-auto w-16 h-16 mb-4 rounded" />
              <h3 className="text-5xl font-bold mb-2">Formalise</h3>
              <h3 className="text-2xl font-bold mb-2">Premarket Edge</h3>
              <p className="mb-4 text-sm leading-tight">
                For a flat fee, our automated agent handles all the due diligence and connects you with everything you need to close the deal – mortgage brokers, conveyancers, removalists, and more.
              </p>
            </div>
          </div>
          </Link>

          {/* Card 3 */}
           <Link href="/agents" className='w-full md:w-1/3'>
          <div className="border-2 my-4 sm:border-l-0 border-white rounded-lg sm:rounded-l-none ">
            <div className="card-inner">
               <img src="/assets/icon3.png" alt="Extend Campaign" className="mx-auto mt-10 w-16 h-16 mb-4 rounded" />
              <h3 className="text-5xl font-bold mb-2">Go to market</h3>
              <h3 className="text-2xl font-bold mb-2">Hire an agent</h3>
              <p className="mb-4 text-sm leading-tight">
                If you're ready to go to market or need help with formalising a deal, you can hire an agent directly through Premarket. Pricing is usually lower if buyer activity is present in Premarket.
              </p>
            </div>
          </div>
          </Link>
        </div>
      </div>
    </section>
  );
}
