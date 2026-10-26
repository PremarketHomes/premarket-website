'use client';

import { motion, useInView, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { db } from '../firebase/clientApp';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import {
import { withOfficeBrand } from '../utils/officeBrand';
import { fetchAgentProfiles } from '../utils/fetchAgentProfiles';
  GradientMesh,
  PulseBadge,
  GlowButton,
} from './marketing/WowFactor';

function ShimmerImage({ src, alt, ...props }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      {!loaded && (
        <div className="absolute inset-0 bg-slate-200 animate-pulse" />
      )}
      <Image
        src={src}
        alt={alt}
        {...props}
        onLoad={() => setLoaded(true)}
        style={{ opacity: loaded ? 1 : 0, transition: 'opacity 0.3s ease' }}
      />
    </>
  );
}

// ══════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════


const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: (delay = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, delay, ease: [0.25, 0.46, 0.45, 0.94] },
  }),
};

const stagger = {
  visible: { transition: { staggerChildren: 0.12 } },
};

// Extract suburb from property (reused from listings)
const AU_STATES = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'];

function getSuburb(p) {
  if (p.location?.suburb) return p.location.suburb;
  if (p.suburb) return p.suburb;
  const formatted = p.formattedAddress || '';
  if (formatted) {
    const segments = formatted.split(',').map(s => s.trim());
    for (const seg of segments) {
      const words = seg.split(/\s+/);
      for (let i = 0; i < words.length; i++) {
        if (AU_STATES.includes(words[i].toUpperCase())) {
          const suburbWords = words.slice(0, i).filter(w => !/^\d+$/.test(w));
          if (suburbWords.length > 0) return suburbWords.join(' ');
        }
      }
    }
  }
  return null;
}

// ══════════════════════════════════════════════
// SECTION 1: HERO WITH SEARCH
// ══════════════════════════════════════════════

function HeroSection() {
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchInputRef = useRef(null);

  const fetchSuggestions = useCallback(async (q) => {
    if (!q || q.length < 2) {
      setSuggestions([]);
      return;
    }
    try {
      const response = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?` +
        `access_token=${process.env.NEXT_PUBLIC_MAPBOX_TOKEN}&` +
        `country=au&types=locality,place,region&limit=5`
      );
      const data = await response.json();
      setSuggestions(data.features || []);
      setShowSuggestions(true);
    } catch (error) {
      console.error('Error fetching suggestions:', error);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => fetchSuggestions(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery, fetchSuggestions]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (searchInputRef.current && !searchInputRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      window.location.href = `/listings?address=${encodeURIComponent(searchQuery.trim())}`;
    }
  };

  const handleSuggestionClick = (suggestion) => {
    const name = suggestion.text || suggestion.place_name.split(',')[0];
    setShowSuggestions(false);
    window.location.href = `/listings?address=${encodeURIComponent(name)}`;
  };

  const quickLinks = [
    { name: 'Sydney', query: 'Sydney' },
    { name: 'Melbourne', query: 'Melbourne' },
    { name: 'Brisbane', query: 'Brisbane' },
    { name: 'Gold Coast', query: 'Gold Coast' },
    { name: 'Perth', query: 'Perth' },
  ];

  return (
    <section className="relative overflow-hidden bg-white">
      {/* Animated gradient mesh — slow, GPU-only */}
      <GradientMesh />
      {/* Subtle warm gradient wash */}
      <div className="absolute inset-0 bg-gradient-to-b from-orange-50/30 via-white/40 to-white" />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 sm:pt-20 lg:pt-28 pb-20 sm:pb-24 lg:pb-32 relative z-10">

        {/* ─── Headline Block ─── */}
        <div className="max-w-4xl mx-auto text-center mb-6">
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="mb-6"
          >
            <PulseBadge>Your opinion shapes the market</PulseBadge>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="text-4xl sm:text-5xl lg:text-[3.5rem] font-bold text-slate-900 leading-[1.1] tracking-tight mb-5"
          >
            What would <em className="not-italic bg-gradient-to-r from-[#e48900] to-[#c64500] bg-clip-text text-transparent">you</em> pay?
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.35 }}
            className="text-lg sm:text-xl text-slate-500 max-w-2xl mx-auto leading-relaxed"
          >
            Browse properties and tell agents what you&apos;d
            actually pay. Anonymous, zero obligation, no sign-up required.
          </motion.p>
        </div>

        {/* ─── Breakout Editorial Line ─── */}
        <motion.div
          initial={{ opacity: 0, scaleX: 0.8 }}
          animate={{ opacity: 1, scaleX: 1 }}
          transition={{ duration: 0.8, delay: 0.5 }}
          className="max-w-3xl mx-auto mb-12"
        >
          <div className="flex items-center gap-4 sm:gap-6">
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-slate-200 to-slate-200" />
            <p className="text-slate-400 text-[13px] sm:text-sm font-medium tracking-wide whitespace-nowrap">
              Your opinion matters.{' '}
              <span className="text-slate-900 font-semibold">Agents are listening.</span>
            </p>
            <div className="flex-1 h-px bg-gradient-to-l from-transparent via-slate-200 to-slate-200" />
          </div>
        </motion.div>

        {/* ─── Search Panel ─── */}
        <motion.div
          initial={{ opacity: 0, y: 25 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.6 }}
          className="max-w-3xl mx-auto mb-14"
        >
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xl shadow-slate-200/50 p-6 sm:p-8 ring-1 ring-slate-100">
            {/* Panel header */}
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-gradient-to-br from-[#e48900] to-[#c64500] rounded-xl flex items-center justify-center shadow-sm">
                  <svg className="w-4.5 h-4.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-900">Find properties near you</p>
                  <p className="text-xs text-slate-400">See what buyers think they&apos;re worth</p>
                </div>
              </div>
              <div className="hidden sm:flex items-center gap-1.5 text-xs text-emerald-600 font-medium bg-emerald-50 px-2.5 py-1 rounded-full">
                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                Live
              </div>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1 relative" ref={searchInputRef}>
                  <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 z-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Enter a suburb, city, or state..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                    className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#e48900]/30 focus:border-[#e48900]/40 focus:bg-white transition-all text-base"
                  />

                  <AnimatePresence>
                    {showSuggestions && suggestions.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.2 }}
                        className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden z-50"
                      >
                        {suggestions.map((suggestion, index) => {
                          const typeLabel = suggestion.place_type?.[0] === 'region' ? 'State'
                            : suggestion.place_type?.[0] === 'place' ? 'City'
                            : 'Suburb';
                          return (
                            <button
                              key={suggestion.id}
                              type="button"
                              onClick={() => handleSuggestionClick(suggestion)}
                              className={`w-full px-4 py-3 text-left hover:bg-orange-50 transition-colors flex items-start gap-3 ${
                                index !== suggestions.length - 1 ? 'border-b border-slate-100' : ''
                              }`}
                            >
                              <svg className="w-5 h-5 text-slate-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                              </svg>
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-slate-900 flex items-center gap-2">
                                  {suggestion.text || suggestion.place_name.split(',')[0]}
                                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                                    {typeLabel}
                                  </span>
                                </div>
                                <div className="text-sm text-slate-500 truncate">
                                  {suggestion.place_name}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                <button
                  type="submit"
                  className="px-8 py-4 bg-gradient-to-r from-[#e48900] to-[#c64500] text-white font-bold rounded-xl hover:shadow-lg hover:shadow-orange-500/25 transition-all flex items-center justify-center gap-2 flex-shrink-0"
                >
                  Search
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </button>
              </div>
            </form>

            {/* Quick links inside the panel */}
            <div className="mt-5 pt-5 border-t border-slate-100 flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold mr-1">Popular</span>
              {quickLinks.map((link) => (
                <Link
                  key={link.name}
                  href={`/listings?address=${encodeURIComponent(link.query)}`}
                  className="px-3.5 py-1 bg-slate-50 hover:bg-slate-100 text-slate-500 hover:text-slate-900 rounded-full text-xs font-medium transition-all border border-slate-150"
                >
                  {link.name}
                </Link>
              ))}
            </div>
          </div>
        </motion.div>

        {/* ─── Three Trust Markers ─── */}
        <motion.div
          initial="hidden"
          animate="visible"
          variants={stagger}
          className="flex flex-wrap justify-center gap-x-10 gap-y-4"
        >
          {[
            { text: 'Free to browse', sub: 'No account needed' },
            { text: 'Real buyer opinions', sub: 'Not algorithm estimates' },
            { text: 'Verified agents', sub: 'Licensed professionals' },
          ].map((item, i) => (
            <motion.div
              key={item.text}
              variants={fadeUp}
              custom={0.8 + i * 0.1}
              className="flex items-center gap-3"
            >
              <div className="w-8 h-8 rounded-full bg-emerald-50 border border-emerald-200/60 flex items-center justify-center flex-shrink-0">
                <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">{item.text}</p>
                <p className="text-xs text-slate-400">{item.sub}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

// ══════════════════════════════════════════════
// SECTION 2: FEATURED PROPERTIES
// ══════════════════════════════════════════════

function FeaturedProperties() {
  const [properties, setProperties] = useState([]);
  const [agents, setAgents] = useState({});
  const [agentDocs, setAgentDocs] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProperties = async () => {
      try {
        const q = query(
          collection(db, 'properties'),
          where('active', '==', true)
        );
        const snapshot = await getDocs(q);
        const docs = snapshot.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(d => d.visibility === true)
          .sort((a, b) => {
            const aTime = a.createdAt?.toMillis?.() || a.created?.toMillis?.() || 0;
            const bTime = b.createdAt?.toMillis?.() || b.created?.toMillis?.() || 0;
            return bTime - aTime;
          })
          .slice(0, 6);

        setProperties(docs);

        // Fetch agent data
        const userIds = [...new Set(docs.map(p => p.userId).filter(Boolean))];
        const agentData = {};
        const agentProfiles = await fetchAgentProfiles(userIds);
        await Promise.all(
          userIds.map(async (userId) => {
            try {
              const userData = agentProfiles[userId];
              if (userData) {
                agentData[userId] = await withOfficeBrand({
                  firstName: userData.firstName,
                  lastName: userData.lastName,
                  companyName: userData.companyName,
                  avatar: userData.avatar,
                  logoUrl: userData.logoUrl,
                  officeId: userData.officeId || null,
                });
              }
            } catch (err) {
              console.error('Error fetching agent:', userId, err);
            }
          })
        );
        setAgents(agentData);

        // Fetch agent docs for properties with agentId
        const agentIds = [...new Set(docs.map(p => p.agentId).filter(Boolean))];
        if (agentIds.length > 0) {
          const agentDocsMap = {};
          await Promise.all(
            agentIds.map(async (agentId) => {
              try {
                const agentDoc = await getDoc(doc(db, 'agents', agentId));
                if (agentDoc.exists()) {
                  agentDocsMap[agentId] = agentDoc.data();
                }
              } catch (err) {
                console.error('Error fetching agent doc:', agentId, err);
              }
            })
          );
          setAgentDocs(agentDocsMap);
        }
      } catch (error) {
        console.error('Error fetching properties:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchProperties();
  }, []);

  return (
    <section className="py-20 lg:py-28 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="text-center mb-14"
        >
          <motion.h2
            variants={fadeUp}
            custom={0}
            className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4"
          >
            Latest Pre-Market Listings
          </motion.h2>
          <motion.p
            variants={fadeUp}
            custom={0.1}
            className="text-lg text-slate-500 max-w-2xl mx-auto"
          >
            Explore properties and share your price opinion. Register interest on the ones you love.
          </motion.p>
        </motion.div>

        {loading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-slate-200 overflow-hidden animate-pulse">
                <div className="aspect-[16/10] bg-slate-200" />
                <div className="p-4 space-y-3">
                  <div className="h-5 bg-slate-200 rounded w-3/4" />
                  <div className="h-4 bg-slate-100 rounded w-full" />
                  <div className="flex gap-4">
                    <div className="h-4 bg-slate-100 rounded w-16" />
                    <div className="h-4 bg-slate-100 rounded w-16" />
                    <div className="h-4 bg-slate-100 rounded w-16" />
                  </div>
                  <div className="pt-3 border-t border-slate-100 flex items-center gap-2">
                    <div className="w-9 h-9 bg-slate-200 rounded-lg" />
                    <div className="space-y-1.5 flex-1">
                      <div className="h-3 bg-slate-200 rounded w-24" />
                      <div className="h-2.5 bg-slate-100 rounded w-32" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : properties.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-slate-500">No properties available right now. Check back soon.</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {properties.map((property, index) => (
              <motion.a
                key={property.id}
                href={`/find-property?propertyId=${property.id}`}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: index * 0.08 }}
                className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden group hover:shadow-xl transition-all duration-300 hover:-translate-y-1"
              >
                <div className="aspect-[16/10] relative overflow-hidden">
                  {property.imageUrls?.[0] ? (
                    <ShimmerImage
                      src={property.imageUrls[0]}
                      alt={property.title || 'Property'}
                      fill
                      className="object-cover group-hover:scale-105 transition-transform duration-300"
                      unoptimized
                    />
                  ) : (
                    <div className="w-full h-full bg-slate-200 flex items-center justify-center">
                      <svg className="w-16 h-16 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                      </svg>
                    </div>
                  )}
                  <div className="absolute top-3 left-3">
                    <span className={`px-3 py-1 rounded-full text-xs font-bold shadow-lg ${
                      property.listingStatus === 'on-market'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-gradient-to-r from-[#e48900] to-[#c64500] text-white'
                    }`}>
                      {property.listingStatus === 'on-market' ? 'On Market' : 'Pre-Market'}
                    </span>
                  </div>
                </div>
                <div className="p-4">
                  <h3 className="font-bold text-slate-900 text-lg mb-1 truncate group-hover:text-[#e48900] transition-colors">
                    {property.title || 'Untitled Property'}
                  </h3>
                  <p className="text-sm text-slate-600 mb-3 truncate flex items-center gap-1">
                    <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                    </svg>
                    <span className="truncate">
                      {property.showSuburbOnly
                        ? (getSuburb(property) || 'Suburb unavailable')
                        : (property.formattedAddress || property.address || 'Address unavailable')}
                    </span>
                  </p>
                  <div className="flex items-center gap-4 text-sm text-slate-700 mb-3">
                    {property.bedrooms && (
                      <span className="flex items-center gap-1">
                        <span className="font-semibold">{property.bedrooms}</span> bed
                      </span>
                    )}
                    {property.bathrooms && (
                      <span className="flex items-center gap-1">
                        <span className="font-semibold">{property.bathrooms}</span> bath
                      </span>
                    )}
                    {property.carSpaces && (
                      <span className="flex items-center gap-1">
                        <span className="font-semibold">{property.carSpaces}</span> car
                      </span>
                    )}
                  </div>

                  {property.userId && agents[property.userId] && (() => {
                    const accountAgent = agents[property.userId];
                    const assignedAgent = property.agentId && agentDocs[property.agentId];
                    // Prefer denormalized fields, then agent doc, then account owner
                    const displayName = property.agentName
                      ? property.agentName
                      : assignedAgent
                        ? assignedAgent.name
                        : [accountAgent.firstName, accountAgent.lastName].filter(Boolean).join(' ');
                    const displayAvatar = property.agentAvatar || assignedAgent?.avatar || accountAgent.avatar;
                    return (
                      <div className="pt-3 border-t border-slate-100">
                        <div className="flex items-center gap-2.5">
                          <div className="flex-shrink-0">
                            {displayAvatar ? (
                              <Image
                                src={displayAvatar}
                                alt={displayName || 'Agent'}
                                width={36}
                                height={36}
                                className="rounded-lg object-cover w-9 h-9"
                                unoptimized
                              />
                            ) : (
                              <div className="w-9 h-9 bg-slate-200 rounded-lg flex items-center justify-center">
                                <svg className="w-4 h-4 text-slate-400" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                                </svg>
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-slate-800 truncate">
                              {displayName}
                            </p>
                            {accountAgent.companyName && (
                              <p className="text-[11px] text-slate-500 truncate font-medium">
                                {accountAgent.companyName}
                              </p>
                            )}
                          </div>
                          {accountAgent.logoUrl && (
                            <div className="flex-shrink-0">
                              <Image
                                src={accountAgent.logoUrl}
                                alt="Agency"
                                width={32}
                                height={32}
                                className="w-8 h-8 rounded-lg object-contain bg-white border border-slate-100"
                                unoptimized
                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </motion.a>
            ))}
          </div>
        )}

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3 }}
          className="text-center mt-12"
        >
          <Link
            href="/listings"
            className="inline-flex items-center gap-2 px-6 py-3 border-2 border-slate-200 hover:border-slate-300 text-slate-700 font-semibold rounded-xl hover:bg-slate-50 transition-all"
          >
            View all properties
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </Link>
        </motion.div>
      </div>
    </section>
  );
}

// ══════════════════════════════════════════════
// SECTION 3: HOW IT WORKS
// ══════════════════════════════════════════════

function HowItWorks() {
  const steps = [
    {
      number: '01',
      title: 'Browse Properties',
      desc: 'Explore listings from verified agents \u2014 pre-market or already live.',
      gradient: 'from-[#e48900] to-[#c64500]',
      icon: (
        <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      ),
    },
    {
      number: '02',
      title: 'Share Your Opinion',
      desc: 'Tell agents what you think a property is worth. Anonymous. No obligation. Your insight matters.',
      gradient: 'from-blue-500 to-blue-600',
      icon: (
        <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      ),
    },
    {
      number: '03',
      title: 'Stay Informed',
      desc: 'Register interest on properties you like and get notified when there are updates.',
      gradient: 'from-emerald-500 to-emerald-600',
      icon: (
        <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
      ),
    },
  ];

  return (
    <section className="py-20 lg:py-28 bg-slate-50 relative overflow-hidden">
      <div className="absolute inset-0 opacity-[0.02]" style={{
        backgroundImage: `radial-gradient(circle at 1px 1px, rgb(0 0 0) 1px, transparent 0)`,
        backgroundSize: '32px 32px',
      }} />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <motion.div
          initial="hidden" whileInView="visible" viewport={{ once: true }}
          className="text-center mb-16"
        >
          <motion.h2 variants={fadeUp} custom={0} className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
            How It Works
          </motion.h2>
          <motion.p variants={fadeUp} custom={0.1} className="text-lg text-slate-500 max-w-2xl mx-auto">
            It takes less than a minute to start exploring and sharing your opinion.
          </motion.p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-8 lg:gap-12">
          {steps.map((step, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: i * 0.15 }}
              className="relative text-center md:text-left"
            >
              {i < steps.length - 1 && (
                <div className="hidden md:block absolute top-10 left-[60%] w-[80%] h-px bg-gradient-to-r from-slate-300 to-transparent z-0" />
              )}
              <div className="relative z-10">
                <div className={`w-20 h-20 rounded-2xl bg-gradient-to-br ${step.gradient} flex items-center justify-center mb-6 shadow-lg mx-auto md:mx-0 text-white`}>
                  {step.icon}
                </div>
                <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">{step.number}</div>
                <h3 className="text-xl font-bold text-slate-900 mb-3">{step.title}</h3>
                <p className="text-slate-600 leading-relaxed">{step.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ══════════════════════════════════════════════
// SECTION 4: TRUST & TRANSPARENCY
// ══════════════════════════════════════════════

function TrustSection() {
  const cards = [
    {
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
      title: 'Real Buyer Opinions',
      desc: 'See what buyers would actually pay — not algorithms or models. Real people, real opinions.',
    },
    {
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      ),
      title: 'Agent Accountability',
      desc: 'Transparent data creates trust. Agents earn your confidence with evidence, not promises.',
    },
    {
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      ),
      title: 'Zero Obligation',
      desc: 'Browse freely, share opinions anonymously, no pressure, no sales calls.',
    },
  ];

  return (
    <section className="py-20 lg:py-28 bg-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial="hidden" whileInView="visible" viewport={{ once: true }}
          className="text-center mb-16"
        >
          <motion.h2 variants={fadeUp} custom={0} className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
            Changing How You Work With Agents
          </motion.h2>
          <motion.p variants={fadeUp} custom={0.1} className="text-lg text-slate-500 max-w-3xl mx-auto">
            For too long, property pricing has been guesswork and broken promises. Premarket changes that.
          </motion.p>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={stagger}
          className="grid md:grid-cols-3 gap-8"
        >
          {cards.map((card, i) => (
            <motion.div
              key={i}
              variants={fadeUp}
              custom={i * 0.1}
              className="bg-slate-50 rounded-2xl p-8 border border-slate-200 hover:border-slate-300 transition-colors"
            >
              <div className="w-14 h-14 bg-gradient-to-br from-orange-100 to-orange-50 rounded-xl flex items-center justify-center text-[#e48900] mb-5">
                {card.icon}
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3">{card.title}</h3>
              <p className="text-slate-600 leading-relaxed">{card.desc}</p>
            </motion.div>
          ))}
        </motion.div>

        {/* Quote callout */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
          className="mt-16 max-w-3xl mx-auto"
        >
          <div className="bg-slate-900 rounded-2xl p-8 lg:p-10 relative overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-orange-500/10 via-transparent to-transparent" />
            <div className="relative z-10 text-center">
              <svg className="w-10 h-10 text-orange-500/30 mx-auto mb-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M11.192 15.757c0-.88-.23-1.618-.69-2.217-.326-.412-.768-.683-1.327-.812-.55-.128-1.07-.137-1.54-.028-.16-.95.1-1.956.76-3.022.66-1.065 1.515-1.867 2.558-2.403L9.373 5c-.8.396-1.56.898-2.26 1.505-.71.607-1.34 1.305-1.9 2.094s-.98 1.68-1.25 2.69-.346 2.04-.217 3.1c.168 1.4.62 2.52 1.356 3.35.735.84 1.652 1.26 2.748 1.26.965 0 1.766-.29 2.4-.878.628-.576.94-1.365.94-2.368l.002.003zm9.124 0c0-.88-.23-1.618-.69-2.217-.326-.42-.77-.692-1.327-.817-.56-.124-1.074-.13-1.54-.022-.16-.94.09-1.95.75-3.02.66-1.06 1.514-1.86 2.557-2.4L18.49 5c-.8.396-1.555.898-2.26 1.505-.708.607-1.34 1.305-1.894 2.094-.556.79-.97 1.68-1.24 2.69-.273 1-.345 2.04-.217 3.1.165 1.4.615 2.52 1.35 3.35.732.833 1.646 1.25 2.742 1.25.967 0 1.768-.29 2.402-.876.627-.576.942-1.365.942-2.368v.01z" />
              </svg>
              <p className="text-xl lg:text-2xl font-bold text-white leading-snug">
                A home is worth what a buyer would pay.{' '}
                <span className="text-slate-400">Not what the house across the street sold for two months ago.</span>
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

// ══════════════════════════════════════════════
// SECTION 5: DATA VS TRADITIONAL
// ══════════════════════════════════════════════

function DataComparison() {
  return (
    <section className="py-20 lg:py-28 bg-slate-50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial="hidden" whileInView="visible" viewport={{ once: true }}
          className="text-center mb-14"
        >
          <motion.h2 variants={fadeUp} custom={0} className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
            A Better Way to Understand Property Value
          </motion.h2>
          <motion.p variants={fadeUp} custom={0.1} className="text-lg text-slate-500 max-w-2xl mx-auto">
            Traditional tools look backward. Premarket looks at what buyers think right now.
          </motion.p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
          className="grid md:grid-cols-2 gap-6"
        >
          {/* Traditional */}
          <div className="bg-white rounded-2xl p-8 border border-slate-200">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-slate-200 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-slate-500">Traditional</h3>
            </div>
            <ul className="space-y-4 text-slate-600">
              <li className="flex items-start gap-3">
                <svg className="w-5 h-5 text-slate-300 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                See a listing, guess the price
              </li>
              <li className="flex items-start gap-3">
                <svg className="w-5 h-5 text-slate-300 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Rely on old comparable sales
              </li>
              <li className="flex items-start gap-3">
                <svg className="w-5 h-5 text-slate-300 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Hope for the best at auction
              </li>
            </ul>
          </div>

          {/* Premarket */}
          <div className="bg-gradient-to-br from-orange-50 to-amber-50/50 rounded-2xl p-8 border-2 border-orange-200">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-gradient-to-br from-[#e48900] to-[#c64500] rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-slate-900">Premarket</h3>
            </div>
            <ul className="space-y-4 text-slate-800">
              <li className="flex items-start gap-3">
                <svg className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Real buyer price opinions on every property
              </li>
              <li className="flex items-start gap-3">
                <svg className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Transparent, data-driven insights
              </li>
              <li className="flex items-start gap-3">
                <svg className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Make informed decisions with confidence
              </li>
            </ul>
          </div>
        </motion.div>
      </div>
    </section>
  );
}


// ══════════════════════════════════════════════
// SECTION 7: FOR AGENTS TEASER
// ══════════════════════════════════════════════

function AgentTeaser() {
  return (
    <section className="py-20 lg:py-28 bg-slate-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
          className="bg-white rounded-2xl p-8 lg:p-12 border border-slate-200 shadow-sm text-center"
        >
          <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-orange-100 text-[#c64500] rounded-full text-sm font-semibold mb-6">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            For Agents
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-4">
            Are you a real estate agent?
          </h2>
          <p className="text-lg text-slate-500 max-w-2xl mx-auto mb-8 leading-relaxed">
            Get buyer-validated pricing data before the listing conversation. Free for every agent, unlimited campaigns.
          </p>
          <Link
            href="/v2"
            className="inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-[#e48900] to-[#c64500] text-white font-bold rounded-xl shadow-lg hover:shadow-orange-500/30 transition-all text-lg"
          >
            Learn More
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </Link>
        </motion.div>
      </div>
    </section>
  );
}

// ══════════════════════════════════════════════
// SECTION 8: FINAL CTA
// ══════════════════════════════════════════════

function FinalCTA() {
  return (
    <section className="py-20 lg:py-28 bg-white">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
        >
          <motion.h2
            variants={fadeUp}
            custom={0}
            className="text-3xl sm:text-4xl lg:text-5xl font-bold text-slate-900 mb-6"
          >
            Start Browsing Properties
          </motion.h2>

          <motion.p
            variants={fadeUp}
            custom={0.1}
            className="text-lg text-slate-500 max-w-2xl mx-auto mb-10"
          >
            Discover properties and share your opinion. Help shape fair pricing with real feedback.
          </motion.p>

          <motion.div
            variants={fadeUp}
            custom={0.2}
            className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-10"
          >
            <GlowButton href="/listings">Browse Properties</GlowButton>
            <Link
              // buyer CTA → /signup
              href="/signup"
              className="inline-flex items-center justify-center px-8 py-4 border-2 border-slate-200 text-slate-700 font-bold text-base rounded-full hover:bg-slate-50 hover:border-slate-300 transition-all"
            >
              Create Free Account
            </Link>
          </motion.div>

          <motion.div
            variants={fadeUp}
            custom={0.3}
            className="flex flex-wrap justify-center gap-6 sm:gap-8 text-sm text-slate-500"
          >
            {['Free to browse', 'No credit card', 'Real properties from real agents'].map((text) => (
              <span key={text} className="flex items-center gap-1.5">
                <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                {text}
              </span>
            ))}
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

// ══════════════════════════════════════════════
// MAIN EXPORT
// ══════════════════════════════════════════════

export default function PublicHomepage() {
  return (
    <>
      <HeroSection />
      <FeaturedProperties />
      <HowItWorks />
      <TrustSection />
      <DataComparison />

      <AgentTeaser />
      <FinalCTA />
    </>
  );
}
