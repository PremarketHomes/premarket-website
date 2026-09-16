'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mail,
  Send,
  CheckCircle2,
  AlertCircle,
  Briefcase,
  LifeBuoy,
  MessageSquare,
  Sparkles,
} from 'lucide-react';
import PublicSiteNav from '../components/public-site/PublicSiteNav';
import PublicSiteFooter from '../components/public-site/PublicSiteFooter';
import { playfairDisplay } from '../components/property-page/fonts';
import {
  Eyebrow,
  fadeUp,
  stagger,
} from '../components/marketing/MarketingShell';
import { ButtonPrimary } from '../components/marketing/Loading';

const TOPICS = [
  {
    key: 'sales',
    label: 'Sales enquiry',
    description: 'For agents, agencies and partnerships.',
    icon: Briefcase,
  },
  {
    key: 'support',
    label: 'Support issue',
    description: 'Bug reports, account access, billing.',
    icon: LifeBuoy,
  },
  {
    key: 'general',
    label: 'General enquiry',
    description: 'Anything else — we read every message.',
    icon: MessageSquare,
  },
];

export default function ContactClient() {
  const [topic, setTopic] = useState('sales');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [company, setCompany] = useState(''); // honeypot
  const [status, setStatus] = useState({ state: 'idle', error: null });

  async function onSubmit(e) {
    e.preventDefault();
    setStatus({ state: 'sending', error: null });
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, name, email, message, company }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Could not send message');
      }
      setStatus({ state: 'sent', error: null });
      setName('');
      setEmail('');
      setMessage('');
    } catch (err) {
      setStatus({ state: 'error', error: err.message });
    }
  }

  return (
    <div className={`bg-white text-slate-900 min-h-screen ${playfairDisplay.variable}`}>
      <PublicSiteNav />
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-orange-50/60 via-white to-white pt-28 sm:pt-36 pb-12">
        <div className="absolute -top-32 -right-32 w-[520px] h-[520px] bg-gradient-to-br from-orange-200/50 to-amber-200/30 rounded-full blur-3xl pointer-events-none" />
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <Eyebrow>Contact</Eyebrow>
          <motion.h1
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            custom={0.05}
            className="mt-6 text-5xl sm:text-6xl tracking-tight text-slate-900 leading-[1.02]"
            style={{ fontFamily: 'var(--font-playfair, serif)', fontWeight: 600 }}
          >
            We'd love to{' '}
            <span className="bg-gradient-to-r from-[#e48900] to-[#c64500] bg-clip-text text-transparent">
              hear from you
            </span>
            .
          </motion.h1>
          <motion.p
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            custom={0.15}
            className="mt-6 text-lg sm:text-xl text-slate-600 max-w-2xl mx-auto leading-relaxed"
          >
            Sales, support, partnerships, or just to say hi — we read every message and
            usually reply within one business day.
          </motion.p>
          <motion.div
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            custom={0.25}
            className="mt-8 inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-full shadow-sm"
          >
            <Mail className="w-4 h-4 text-[#c64500]" />
            <span className="text-sm font-semibold text-slate-700">
              Or email us directly:{' '}
              <a href="mailto:knockknock@premarket.homes" className="text-[#c64500] hover:underline">
                knockknock@premarket.homes
              </a>
            </span>
          </motion.div>
        </div>
      </section>

      {/* Form */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 pb-24 sm:pb-32">
        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          custom={0.35}
          className="rounded-[2rem] border border-slate-200 bg-white shadow-xl shadow-slate-900/[0.04] p-8 sm:p-12"
        >
          {/* Topic picker */}
          <div className="mb-10">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-4">
              What is this about?
            </p>
            <motion.div
              variants={stagger}
              initial="hidden"
              animate="visible"
              className="grid grid-cols-1 sm:grid-cols-3 gap-3"
            >
              {TOPICS.map((t) => {
                const Icon = t.icon;
                const active = topic === t.key;
                return (
                  <motion.button
                    key={t.key}
                    type="button"
                    variants={fadeUp}
                    onClick={() => setTopic(t.key)}
                    className={`text-left p-6 rounded-2xl border transition-all ${
                      active
                        ? 'border-[#e48900] bg-orange-50/40 shadow-[0_8px_24px_-12px_rgba(228,137,0,0.35)]'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <Icon
                      className={`w-6 h-6 mb-5 ${active ? 'text-[#c64500]' : 'text-slate-400'}`}
                      strokeWidth={1.75}
                    />
                    <p className="font-bold text-slate-900 text-base">{t.label}</p>
                    <p className="mt-1.5 text-xs text-slate-500 leading-relaxed">
                      {t.description}
                    </p>
                  </motion.button>
                );
              })}
            </motion.div>
          </div>

          <form onSubmit={onSubmit} className="space-y-6">
            {/* Honeypot */}
            <input
              type="text"
              name="company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              className="hidden"
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label
                  htmlFor="name"
                  className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2"
                >
                  Your name
                </label>
                <input
                  id="name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-[#e48900] focus:ring-2 focus:ring-orange-500/20 transition-all"
                  placeholder="Sarah Mitchell"
                />
              </div>
              <div>
                <label
                  htmlFor="email"
                  className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2"
                >
                  Your email
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-[#e48900] focus:ring-2 focus:ring-orange-500/20 transition-all"
                  placeholder="sarah@example.com"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="message"
                className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2"
              >
                Message
              </label>
              <textarea
                id="message"
                required
                rows={6}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-[#e48900] focus:ring-2 focus:ring-orange-500/20 transition-all resize-none"
                placeholder="Tell us what's on your mind..."
                maxLength={5000}
              />
              <p className="mt-2 text-xs text-slate-400">
                {message.length}/5000 characters
              </p>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pt-2">
              <p className="text-xs text-slate-500">
                By submitting you agree to our{' '}
                <a href="/privacy" className="underline hover:text-[#c64500]">
                  privacy policy
                </a>
                .
              </p>
              <ButtonPrimary
                type="submit"
                isLoading={status.state === 'sending'}
                loadingLabel="Sending"
                disabled={status.state === 'sent'}
                trailingIcon={status.state !== 'sent'}
              >
                {status.state === 'sent' ? (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    Sent
                  </>
                ) : (
                  'Send message'
                )}
              </ButtonPrimary>
            </div>

            <AnimatePresence>
              {status.state === 'sent' && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-start gap-3 p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800"
                >
                  <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold">Message received</p>
                    <p className="text-sm text-emerald-700/80 mt-0.5">
                      We'll get back to you within one business day. Often faster.
                    </p>
                  </div>
                </motion.div>
              )}
              {status.state === 'error' && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-start gap-3 p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800"
                >
                  <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold">{status.error}</p>
                    <p className="text-sm text-rose-700/80 mt-0.5">
                      You can email us directly at{' '}
                      <a
                        href="mailto:knockknock@premarket.homes"
                        className="underline font-semibold"
                      >
                        knockknock@premarket.homes
                      </a>
                      .
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </form>
        </motion.div>

        {/* Side info */}
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.2 }}
          className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4"
        >
          {[
            {
              icon: Sparkles,
              title: 'New to Premarket?',
              body: 'Start with the explainer.',
              href: '/premarket',
              cta: 'Read it',
            },
            {
              icon: Briefcase,
              title: 'Listing agent?',
              body: 'See how reports and PHI work.',
              href: '/features',
              cta: 'Explore features',
            },
            {
              icon: MessageSquare,
              title: 'Buyer or buyer\'s agent?',
              body: 'Sign up free in under a minute.',
              href: '/signup',
              cta: 'Create account',
            },
          ].map((c) => {
            const Icon = c.icon;
            return (
              <motion.a
                key={c.title}
                variants={fadeUp}
                href={c.href}
                className="group block p-5 rounded-2xl bg-white border border-slate-200 hover:border-orange-200 hover:shadow-sm transition-all"
              >
                <Icon className="w-5 h-5 text-[#c64500] mb-3" />
                <p className="font-bold text-slate-900 text-sm">{c.title}</p>
                <p className="text-xs text-slate-500 mt-0.5">{c.body}</p>
                <p className="mt-2 text-xs font-semibold text-[#c64500] group-hover:underline">
                  {c.cta} →
                </p>
              </motion.a>
            );
          })}
        </motion.div>
      </section>

      <PublicSiteFooter />
    </div>
  );
}
