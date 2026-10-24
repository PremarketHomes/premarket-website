import Image from 'next/image';
// components/FAQHomeOwners.js
export default function FAQHomeOwners() {
  const faqs = [
    {
      question: "How much does Premarket cost me as a homeowner?",
      answer: "Absolutely nothing. It's completely free. Why? Because we want to transform the real estate ecosystem. We earn through agent subscriptions and referrals — never from homeowners or buyers. Just pure value for you.",
      color: "bg-emerald-50 border-emerald-200",
      icon: "💚"
    },
    {
      question: "What happens when my campaign ends?",
      answer: "You receive a comprehensive report with all buyer interest, price opinions, and engagement data. Plus, you get a curated list of recommended agents to choose from. You're in complete control of the next step.",
      color: "bg-blue-50 border-blue-200",
      icon: "📊"
    },
    {
      question: "What if my campaign gets underwhelming results?",
      answer: "That's actually a win. You've learned the market truth without risking thousands on marketing or hosting open homes. Now you can adjust your price expectations to match what buyers are actually willing to pay — saving you time and money.",
      color: "bg-purple-50 border-purple-200",
      icon: "💡"
    },
    {
      question: "Can I sell my home without an agent?",
      answer: "Yes, you can. If you prefer not to choose a recommended agent, speak to our team about getting buyer details directly. We're here to support whatever path works best for you.",
      color: "bg-amber-50 border-amber-200",
      icon: "🏡"
    },
    {
      question: "Do you take any commission from the sale?",
      answer: "Never. Zero commission. We don't take a cent from your sale. Our revenue comes from agent subscriptions, not from homeowners. Your sale price is 100% yours (minus your chosen agent's standard fee).",
      color: "bg-rose-50 border-rose-200",
      icon: "🚫"
    },
    {
      question: "Are there any hidden costs?",
      answer: "Nope. Just value. No setup fees, no listing fees, no surprise charges. What you see is what you get — a free service designed to give you confidence and market intelligence.",
      color: "bg-teal-50 border-teal-200",
      icon: "✨"
    },
    {
      question: "How does Premarket give me confidence to sell?",
      answer: "You get real buyer interest before committing to anything. See actual price opinions, gauge genuine demand, and understand your market position — all before spending a dollar on marketing or choosing an agent. Knowledge is confidence.",
      color: "bg-indigo-50 border-indigo-200",
      icon: "💪"
    },
    {
      question: "Do I need professional photos to start?",
      answer: "Not at all. Premarket is about testing genuine buyer interest with your home as it is. Phone photos work perfectly. Think of it as a low-pressure market test, not a sales pitch. You can always upgrade photos later when you officially list.",
      color: "bg-cyan-50 border-cyan-200",
      icon: "📱"
    },
    {
      question: "How long does a campaign run?",
      answer: "Typically 2-4 weeks, giving you enough time to gather meaningful buyer feedback and price opinions. This timeframe helps you understand market appetite without dragging out the process.",
      color: "bg-orange-50 border-orange-200",
      icon: "📅"
    },
    {
      question: "What information do buyers see about my property?",
      answer: "Buyers see your photos, property details, and location. You control what information you share. It's designed to generate genuine interest while protecting your privacy until you're ready to move forward.",
      color: "bg-pink-50 border-pink-200",
      icon: "🔍"
    },
    {
      question: "Are you part of other property platforms?",
      answer: "No, we're completely independent. Premarket was founded in Northern Rivers, NSW by three dads who wanted to create a better, fairer system for everyone. No corporate ties, just genuine innovation.",
      color: "bg-violet-50 border-violet-200",
      icon: "🌊"
    },
    {
      question: "What if I get strong interest? Do I have to sell?",
      answer: "Not at all. Strong interest simply gives you confidence and leverage. You choose if and when to move forward, which agent to work with, and what price you're comfortable with. Premarket is about empowering your decisions, not forcing them.",
      color: "bg-lime-50 border-lime-200",
      icon: "🎯"
    },
    {
      question: "How do I know the buyer interest is real?",
      answer: "These are verified buyers in our network actively looking for properties. They submit price opinions and engagement data that you can see. Unlike random online clicks, this is genuine market feedback from people ready to buy.",
      color: "bg-sky-50 border-sky-200",
      icon: "✅"
    },
    {
      question: "Can I run a campaign privately without neighbors knowing?",
      answer: "Yes. Premarket lets you test the market discreetly. You're gauging interest before making any public commitment, giving you the freedom to explore your options without the neighborhood gossip or pressure.",
      color: "bg-fuchsia-50 border-fuchsia-200",
      icon: "🤫"
    },
    {
      question: "What makes Premarket different from getting an appraisal?",
      answer: "An appraisal is one agent's opinion. Premarket gives you real buyer opinions, actual interest levels, and market validation. You're getting data-driven confidence, not just someone's estimate designed to win your listing.",
      color: "bg-amber-50 border-amber-200",
      icon: "📈"
    }
  ];

  return (
    <div className="bg-gray-50 py-16 sm:py-24">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12 sm:mb-16 max-w-3xl mx-auto">
          <h2 className="text-4xl sm:text-6xl font-extrabold text-gray-900 mb-4">
            Homeowner Questions
          </h2>
          <p className="text-lg sm:text-xl text-gray-600">
            Get confidence and clarity before committing to anything
          </p>
        </div>

        {/* FAQ Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-7xl mx-auto">
          {faqs.map((faq, index) => (
            <div
              key={index}
              className={`${faq.color} border-2 rounded-xl p-6 hover:shadow-lg transition-all duration-300 hover:scale-105 cursor-default`}
            >
              <div className="text-4xl mb-4">{faq.icon}</div>
              <h3 className="text-lg font-bold text-gray-900 mb-3 leading-tight">
                {faq.question}
              </h3>
              <p className="text-gray-700 text-sm leading-relaxed">
                {faq.answer}
              </p>
            </div>
          ))}
        </div>

        {/* CTA Footer */}
        <div className="mt-16 text-center bg-white rounded-2xl p-8 sm:p-12 shadow-lg max-w-4xl mx-auto">
          <h3 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-4">
            Ready to test your market?
          </h3>
          <p className="text-gray-600 mb-6 text-lg">
            Start your free Premarket campaign today and see what buyers really think
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            
{/*             
            <a href="https://calendly.com/knockknock-premarket/30min?month=2025-08"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block bg-white hover:bg-gray-50 text-gray-900 border-2 border-gray-300 font-bold py-4 px-8 rounded-lg transition-colors"
            >
              Speak to Our Team
            </a> */}
          </div>
        </div>
      </div>
    </div>
  );
}