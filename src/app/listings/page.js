'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { db } from '../firebase/clientApp';
import { collection, query, where, orderBy, getDocs, doc, getDoc } from 'firebase/firestore';
import Nav from '../components/Nav';
import FooterLarge from '../components/FooterLarge';
import LikeButton from '../components/LikeButton';
import BrandMark from '../components/BrandMark';
import { SkeletonCard, Spinner } from '../components/marketing/Loading';
import { Sparkles, ShieldCheck, Heart, MessageSquare } from 'lucide-react';
import { withOfficeBrand } from '../utils/officeBrand';
import { fetchAgentProfiles } from '../utils/fetchAgentProfiles';

function ShimmerImage({ src, alt, ...props }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      {!loaded && (
        <div className="absolute inset-0 bg-slate-100 overflow-hidden">
          <div className="absolute inset-0 -translate-x-full animate-skeleton bg-gradient-to-r from-transparent via-white/60 to-transparent" />
          <style jsx>{`
            @keyframes skeleton { 100% { transform: translateX(100%); } }
            .animate-skeleton { animation: skeleton 1.6s ease-in-out infinite; }
          `}</style>
        </div>
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

const RADIUS_OPTIONS = [
  { value: '', label: 'Any Distance' },
  { value: '5', label: '5 km' },
  { value: '10', label: '10 km' },
  { value: '25', label: '25 km' },
  { value: '50', label: '50 km' },
  { value: '100', label: '100 km' },
];

const PROPERTY_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'House', label: 'House' },
  { value: 'Apartment', label: 'Apartment' },
  { value: 'Townhouse', label: 'Townhouse' },
  { value: 'Land', label: 'Land' },
];

const BEDROOM_OPTIONS = [
  { value: '', label: 'Any' },
  { value: '1', label: '1+' },
  { value: '2', label: '2+' },
  { value: '3', label: '3+' },
  { value: '4', label: '4+' },
  { value: '5', label: '5+' },
];

const PRICE_RANGES = [
  { value: '', label: 'Any Price' },
  { value: '0-500000', label: 'Under $500K' },
  { value: '500000-750000', label: '$500K - $750K' },
  { value: '750000-1000000', label: '$750K - $1M' },
  { value: '1000000-1500000', label: '$1M - $1.5M' },
  { value: '1500000-2000000', label: '$1.5M - $2M' },
  { value: '2000000-', label: '$2M+' },
];

// Animated education cards data
const BUYER_EDUCATION = [
  {
    Icon: MessageSquare,
    title: "Price Opinions Wanted",
    description: "Agents are looking for real buyer feedback. Share what you think these properties are worth.",
  },
  {
    Icon: ShieldCheck,
    title: "Real Properties",
    description: "Every property is listed by a verified agent looking for genuine buyer price opinions.",
  },
  {
    Icon: Heart,
    title: "Register Interest",
    description: "Share your price opinion and register interest to stay updated on properties you like.",
  },
  {
    Icon: Sparkles,
    title: "Zero Obligation",
    description: "Share your price opinion freely. No commitments, no pressure, no sales calls.",
  },
];

// Extract lat/lng from various location formats (plain object, GeoPoint, nested geopoint)
function getCoords(p) {
  const loc = p.location;
  if (!loc) return null;
  // Firestore GeoPoint objects (client SDK) have _lat/_long or latitude/longitude getters
  if (typeof loc.latitude === 'number' && typeof loc.longitude === 'number') {
    return { lat: loc.latitude, lng: loc.longitude };
  }
  // Firestore GeoPoint serialised with underscore-prefixed fields
  if (typeof loc._latitude === 'number' && typeof loc._longitude === 'number') {
    return { lat: loc._latitude, lng: loc._longitude };
  }
  // Nested geopoint field (GeoFirestore format)
  const gp = loc.geopoint;
  if (gp) {
    if (typeof gp.latitude === 'number' && typeof gp.longitude === 'number') {
      return { lat: gp.latitude, lng: gp.longitude };
    }
    if (typeof gp._latitude === 'number' && typeof gp._longitude === 'number') {
      return { lat: gp._latitude, lng: gp._longitude };
    }
  }
  // Short-form keys
  if (typeof loc.lat === 'number' && typeof loc.lng === 'number') {
    return { lat: loc.lat, lng: loc.lng };
  }
  return null;
}

function haversineDistance(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const AU_STATES = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'];

function getSuburb(p) {
  // Direct field
  if (p.location?.suburb) return p.location.suburb;
  if (p.suburb) return p.suburb;
  // Parse formattedAddress: "123 Street, Suburb NSW 2000, Australia"
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

function ListingsContent() {
  const searchParams = useSearchParams();
  const [properties, setProperties] = useState([]);
  const [filteredProperties, setFilteredProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [suburbs, setSuburbs] = useState([]);
  const [showAllSuburbs, setShowAllSuburbs] = useState(false);
  const [activeEducationCard, setActiveEducationCard] = useState(0);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [agents, setAgents] = useState({});
  const [agentDocs, setAgentDocs] = useState({});
  const searchInputRef = useRef(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSuburb, setSelectedSuburb] = useState('');
  const [propertyType, setPropertyType] = useState('');
  const [minBedrooms, setMinBedrooms] = useState('');
  const [priceRange, setPriceRange] = useState('');
  const [radius, setRadius] = useState('25');
  const [searchCoords, setSearchCoords] = useState(null); // { lat, lng }
  const [showFilters, setShowFilters] = useState(false);

  // Initialize search from URL params — geocode if an address/suburb is provided
  useEffect(() => {
    const address = searchParams.get('address');
    const suburb = searchParams.get('suburb');
    if (address) {
      setSearchQuery(address);
      // Geocode the address param to get coordinates
      geocodeQuery(address).then(result => {
        if (result) {
          setSearchCoords(result.coords);
          setSearchQuery(result.name);
        }
      });
    }
    if (suburb) setSelectedSuburb(suburb);
  }, [searchParams]);

  // Auto-rotate education cards
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveEducationCard((prev) => (prev + 1) % BUYER_EDUCATION.length);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Mapbox geocoding autocomplete — suburbs, cities, and states only
  const fetchSuggestions = async (q) => {
    if (!q || q.length < 2) {
      setSuggestions([]);
      return;
    }

    try {
      const response = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?` +
        `access_token=${process.env.NEXT_PUBLIC_MAPBOX_TOKEN}&` +
        `country=au&` +
        `types=locality,place,region&` +
        `limit=5`
      );
      const data = await response.json();
      setSuggestions(data.features || []);
      setShowSuggestions(true);
    } catch (error) {
      console.error('Error fetching suggestions:', error);
    }
  };

  // Geocode a freeform query to coordinates
  const geocodeQuery = async (q) => {
    if (!q || q.length < 2) return null;
    try {
      const response = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?` +
        `access_token=${process.env.NEXT_PUBLIC_MAPBOX_TOKEN}&` +
        `country=au&` +
        `types=locality,place,region&` +
        `limit=1`
      );
      const data = await response.json();
      if (data.features?.length > 0) {
        const feature = data.features[0];
        return {
          coords: { lng: feature.center[0], lat: feature.center[1] },
          name: feature.text || feature.place_name.split(',')[0],
        };
      }
    } catch (error) {
      console.error('Geocode error:', error);
    }
    return null;
  };

  // Debounce search input for autocomplete
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchSuggestions(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (searchInputRef.current && !searchInputRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSuggestionClick = (suggestion) => {
    setSearchQuery(suggestion.text || suggestion.place_name.split(',')[0]);
    setShowSuggestions(false);
    if (suggestion.center) {
      setSearchCoords({ lng: suggestion.center[0], lat: suggestion.center[1] });
      if (!radius) setRadius('25');
    }
  };

  // Fetch all properties
  const fetchProperties = async () => {
    setLoading(true);
    try {
      // Simple query - filter active properties
      const q = query(
        collection(db, 'properties'),
        where('active', '==', true)
      );

      const snapshot = await getDocs(q);
      // Filter visibility client-side and sort by newest first
      const docs = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(doc => doc.visibility === true)
        .sort((a, b) => {
          const aTime = a.createdAt?.toMillis?.() || a.created?.toMillis?.() || 0;
          const bTime = b.createdAt?.toMillis?.() || b.created?.toMillis?.() || 0;
          return bTime - aTime;
        });

      setProperties(docs);

      // Extract unique suburbs — try location.suburb first, then parse formattedAddress
      const suburbSet = new Set();
      docs.forEach(p => {
        const suburb = getSuburb(p);
        if (suburb) suburbSet.add(suburb);
      });
      setSuburbs(Array.from(suburbSet).sort());

      // Fetch agent data for all unique userIds
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

  useEffect(() => {
    fetchProperties();
  }, []);

  // Filter properties
  useEffect(() => {
    let filtered = [...properties];

    // Radius-based geo filtering (when coordinates are set from geocoding)
    if (searchCoords && radius) {
      const maxDist = parseFloat(radius);
      filtered = filtered
        .map(p => {
          const coords = getCoords(p);
          if (!coords) return null;
          const dist = haversineDistance(searchCoords.lat, searchCoords.lng, coords.lat, coords.lng);
          if (dist > maxDist) return null;
          return { ...p, _distance: dist };
        })
        .filter(Boolean)
        .sort((a, b) => a._distance - b._distance);
    } else if (searchCoords) {
      // Coords set but no radius — sort by distance, show all
      filtered = filtered
        .map(p => {
          const coords = getCoords(p);
          if (!coords) return { ...p, _distance: Infinity };
          return { ...p, _distance: haversineDistance(searchCoords.lat, searchCoords.lng, coords.lat, coords.lng) };
        })
        .sort((a, b) => a._distance - b._distance);
    }

    if (selectedSuburb) {
      filtered = filtered.filter(p =>
        getSuburb(p)?.toLowerCase() === selectedSuburb.toLowerCase()
      );
    }

    if (propertyType) {
      filtered = filtered.filter(p => {
        const typeMap = { 1: 'House', 2: 'Apartment', 3: 'Villa', 4: 'Townhouse', 5: 'Acreage', 6: 'Duplex' };
        const pType = typeMap[p.propertyType] || p.propertyJob?.property_data?.property_type;
        return pType?.toLowerCase() === propertyType.toLowerCase();
      });
    }

    if (minBedrooms) {
      filtered = filtered.filter(p => (p.bedrooms || 0) >= parseInt(minBedrooms));
    }

    if (priceRange) {
      const [min, max] = priceRange.split('-').map(v => v ? parseInt(v) : null);
      filtered = filtered.filter(p => {
        const price = parseFloat(String(p.price).replace(/[^0-9.]/g, '')) || 0;
        if (min && price < min) return false;
        if (max && price > max) return false;
        return true;
      });
    }

    setFilteredProperties(filtered);
  }, [properties, searchQuery, searchCoords, radius, selectedSuburb, propertyType, minBedrooms, priceRange]);

  const [searching, setSearching] = useState(false);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    // If we already have coordinates (user clicked a suggestion), no need to geocode
    if (searchCoords) return;

    // Geocode the typed query
    setSearching(true);
    const result = await geocodeQuery(searchQuery);
    if (result) {
      setSearchCoords(result.coords);
      setSearchQuery(result.name);
      if (!radius) setRadius('25');
    }
    setSearching(false);
  };

  const clearFilters = () => {
    setSearchQuery('');
    setSelectedSuburb('');
    setPropertyType('');
    setMinBedrooms('');
    setPriceRange('');
    setRadius('25');
    setSearchCoords(null);
  };

  const activeFilterCount = [selectedSuburb, propertyType, minBedrooms, priceRange, searchCoords ? radius : ''].filter(Boolean).length;

  const displayedSuburbs = showAllSuburbs ? suburbs : suburbs.slice(0, 5);

  return (
    <div className="min-h-screen bg-white">
      <Nav />

      {/* Hero Section — light themed with image accent */}
      <div className="relative bg-gradient-to-b from-orange-50/60 via-white to-white overflow-hidden border-b border-slate-100">
        {/* Soft brand accent washes */}
        <div className="absolute -top-32 -right-32 w-[520px] h-[520px] bg-gradient-to-br from-orange-200/40 to-amber-200/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-40 -left-40 w-[420px] h-[420px] bg-gradient-to-tr from-orange-100/40 to-amber-100/10 rounded-full blur-3xl pointer-events-none" />
        {/* BrandMark watermark */}
        <div className="absolute top-12 right-10 hidden lg:block opacity-[0.06] pointer-events-none">
          <BrandMark size={220} />
        </div>

        <div className="max-w-7xl mx-auto px-4 pt-10 pb-10 lg:pt-16 lg:pb-14 relative z-10">
          {/* Breadcrumbs */}
          <nav className="mb-6">
            <ol className="flex items-center gap-2 text-sm text-slate-500">
              <li>
                <a href="/" className="hover:text-[#c64500] transition-colors">Home</a>
              </li>
              <li>
                <svg className="w-4 h-4 text-slate-300" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
              </li>
              <li className="text-slate-900 font-semibold">Property Listings</li>
            </ol>
          </nav>

          {/* Eyebrow + Title */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center mb-8 max-w-3xl mx-auto"
          >
            <div className="inline-flex items-center gap-2.5 mb-5">
              <BrandMark size={14} />
              <span className="text-[11px] font-bold text-[#c64500] uppercase tracking-[0.18em]">
                Browse properties
              </span>
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-[3.5rem] font-bold tracking-tight text-slate-900 leading-[1.04]">
              Real homes.{' '}
              <span className="bg-gradient-to-r from-[#e48900] to-[#c64500] bg-clip-text text-transparent">
                Real buyer evidence.
              </span>
            </h1>
            <p className="mt-5 text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed">
              Share your price opinion on Australian properties and register your interest with the agents who matter.
            </p>
          </motion.div>

          {/* Search Bar */}
          <motion.form
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            onSubmit={handleSearch}
            className="max-w-3xl mx-auto"
          >
            <div className="flex flex-col sm:flex-row gap-3 p-2 bg-white border border-slate-200 rounded-2xl shadow-[0_24px_60px_-30px_rgba(15,23,42,0.18)]">
              <div className="flex-1 relative" ref={searchInputRef}>
                <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 z-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Search suburb, city, or state..."
                  value={searchQuery}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSearchQuery(val);
                    // Clear coordinates when user edits — they need to re-select or re-search
                    if (searchCoords) setSearchCoords(null);
                    // Clear search if input emptied
                    if (!val.trim()) {
                      setSearchCoords(null);
                    }
                  }}
                  onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                  className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border border-transparent rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-[#e48900] focus:ring-2 focus:ring-orange-500/20 transition-all"
                />

                {/* Autocomplete Suggestions Dropdown */}
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
              <select
                value={radius}
                onChange={(e) => setRadius(e.target.value)}
                className="px-4 py-3.5 bg-slate-50 border border-transparent rounded-xl text-slate-700 font-medium focus:outline-none focus:bg-white focus:border-[#e48900] focus:ring-2 focus:ring-orange-500/20 appearance-none cursor-pointer min-w-[140px] transition-all"
                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%2394a3b8' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10l-5 5z'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 14px center' }}
              >
                {RADIUS_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value} className="text-slate-900">{opt.label}</option>
                ))}
              </select>
              <button
                type="submit"
                disabled={searching}
                className="px-8 py-3.5 bg-[#e48900] text-white text-sm font-semibold rounded-xl hover:bg-[#c64500] active:scale-[0.98] transition-all disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {searching ? (
                  <>
                    <Spinner size={14} strokeColor="white" />
                    Searching
                  </>
                ) : 'Search'}
              </button>
            </div>
          </motion.form>

          {/* Suburb Quick Links */}
          {suburbs.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="mt-6 text-center"
            >
              <span className="text-slate-500 text-xs font-semibold uppercase tracking-wider mr-3">Popular suburbs</span>
              {displayedSuburbs.map((suburb) => (
                <button
                  key={suburb}
                  onClick={() => setSelectedSuburb(selectedSuburb === suburb ? '' : suburb)}
                  className={`inline-block px-3.5 py-1.5 mr-2 mb-2 text-xs font-semibold rounded-full transition-all ${
                    selectedSuburb === suburb
                      ? 'bg-[#e48900] text-white shadow-[0_4px_12px_-4px_rgba(228,137,0,0.5)]'
                      : 'bg-white border border-slate-200 text-slate-700 hover:border-[#e48900] hover:text-[#c64500]'
                  }`}
                >
                  {suburb}
                </button>
              ))}
              {suburbs.length > 5 && (
                <button
                  onClick={() => setShowAllSuburbs(!showAllSuburbs)}
                  className="text-[#c64500] hover:text-[#e48900] text-xs font-bold underline-offset-4 hover:underline"
                >
                  {showAllSuburbs ? 'Show less' : `+${suburbs.length - 5} more`}
                </button>
              )}
            </motion.div>
          )}
        </div>
      </div>

      {/* Filters Bar */}
      <div className="bg-white border-b border-slate-200 sticky top-16 lg:top-20 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Filter Toggle (Mobile) */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="lg:hidden flex items-center gap-2 px-4 py-2 bg-slate-100 border border-slate-200 rounded-lg text-slate-700 font-medium"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              Filters
              {activeFilterCount > 0 && (
                <span className="bg-orange-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center">
                  {activeFilterCount}
                </span>
              )}
            </button>

            {/* Desktop Filters */}
            <div className="hidden lg:flex items-center gap-3 flex-wrap">
              <select
                value={propertyType}
                onChange={(e) => setPropertyType(e.target.value)}
                className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              >
                {PROPERTY_TYPES.map(type => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>

              <select
                value={minBedrooms}
                onChange={(e) => setMinBedrooms(e.target.value)}
                className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              >
                <option value="">Bedrooms</option>
                {BEDROOM_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>

              <select
                value={priceRange}
                onChange={(e) => setPriceRange(e.target.value)}
                className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              >
                {PRICE_RANGES.map(range => (
                  <option key={range.value} value={range.value}>{range.label}</option>
                ))}
              </select>

              {activeFilterCount > 0 && (
                <button
                  onClick={clearFilters}
                  className="px-4 py-2 text-orange-600 hover:text-orange-700 font-medium"
                >
                  Clear all
                </button>
              )}
            </div>

            {/* Results Count */}
            <div className="text-slate-600 text-sm flex items-center gap-2">
              <span className="font-semibold text-slate-900">{filteredProperties.length}</span> properties
              {searchCoords && radius && (
                <span className="text-xs text-slate-400">
                  within {radius} km of {searchQuery}
                </span>
              )}
            </div>
          </div>

          {/* Mobile Filters Dropdown */}
          <AnimatePresence>
            {showFilters && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="lg:hidden mt-3 pt-3 border-t border-slate-200 grid grid-cols-2 gap-3"
              >
                <select
                  value={propertyType}
                  onChange={(e) => setPropertyType(e.target.value)}
                  className="px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-700"
                >
                  {PROPERTY_TYPES.map(type => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </select>

                <select
                  value={minBedrooms}
                  onChange={(e) => setMinBedrooms(e.target.value)}
                  className="px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-700"
                >
                  <option value="">Bedrooms</option>
                  {BEDROOM_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>

                <select
                  value={priceRange}
                  onChange={(e) => setPriceRange(e.target.value)}
                  className="col-span-2 px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-700"
                >
                  {PRICE_RANGES.map(range => (
                    <option key={range.value} value={range.value}>{range.label}</option>
                  ))}
                </select>

                {activeFilterCount > 0 && (
                  <button
                    onClick={clearFilters}
                    className="col-span-2 py-2 text-orange-600 font-medium"
                  >
                    Clear all filters
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Main Content - 2/3 Grid + Sidebar */}
      <div className="max-w-7xl mx-auto px-4 py-8 lg:py-10">
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Property Grid - 2/3 */}
          <div className="lg:w-2/3">
            {loading ? (
              <div className="grid sm:grid-cols-2 gap-5">
                {Array.from({ length: 6 }).map((_, i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            ) : filteredProperties.length === 0 ? (
              <div className="text-center py-20 bg-white rounded-2xl border border-slate-200">
                <div className="inline-flex mb-6">
                  <BrandMark size={40} loading />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">No properties found</h3>
                <p className="text-slate-600 mb-6">Try adjusting your filters or search criteria</p>
                <button
                  onClick={clearFilters}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-[#e48900] text-white text-sm font-semibold rounded-full hover:bg-[#c64500] active:scale-[0.98] transition-all"
                >
                  Clear all filters
                </button>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-5">
                {filteredProperties.map((property, index) => (
                  <motion.a
                    key={property.id}
                    href={`/find-property?propertyId=${property.id}`}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: index * 0.03 }}
                    className="bg-white rounded-2xl shadow-md border border-slate-200 overflow-hidden group hover:shadow-xl transition-all duration-300 hover:-translate-y-1"
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
                          <svg className="w-16 h-16 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                          </svg>
                        </div>
                      )}
                      <div className="absolute top-3 right-3 z-10">
                        <LikeButton propertyId={property.id} size="sm" variant="overlay" />
                      </div>
                      <div className="absolute top-3 left-3 flex items-center gap-2">
                        <span className={`px-3 py-1 rounded-full text-xs font-bold shadow-[0_4px_12px_-4px_rgba(0,0,0,0.25)] ${
                          property.listingStatus === 'on-market'
                            ? 'bg-emerald-600 text-white'
                            : 'bg-[#e48900] text-white'
                        }`}>
                          {property.listingStatus === 'on-market' ? 'On Market' : 'Pre-Market'}
                        </span>
                        {(property.videoUrl || property.aiVideo?.url) && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-full bg-black/60 text-white shadow-lg">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                            Video
                          </span>
                        )}
                      </div>
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          window.open(`/find-property?propertyId=${property.id}&mode=ipad`, '_blank');
                        }}
                        className="absolute bottom-3 left-3 px-2.5 py-1.5 bg-black/60 hover:bg-black/80 backdrop-blur-sm text-white rounded-lg text-xs font-semibold shadow-lg transition-colors flex items-center gap-1.5 opacity-0 group-hover:opacity-100"
                        title="Open in iPad mode for open homes"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                        iPad
                      </button>
                    </div>
                    <div className="p-4">
                      <h3 className="font-bold text-slate-900 text-lg mb-1 truncate group-hover:text-orange-600 transition-colors">
                        {property.title || 'Untitled Property'}
                      </h3>
                      <p className="text-sm text-slate-600 mb-3 truncate flex items-center gap-1">
                        <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                        </svg>
                        <span className="truncate">
                          {property.showSuburbOnly
                            ? (property.address || getSuburb(property) || 'Suburb unavailable')
                            : (property.formattedAddress || property.address || 'Address unavailable')}
                        </span>
                        {property._distance != null && property._distance !== Infinity && (
                          <span className="flex-shrink-0 text-xs text-slate-400 ml-1">
                            {property._distance < 1
                              ? `${Math.round(property._distance * 1000)}m`
                              : `${Math.round(property._distance)} km`}
                          </span>
                        )}
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

                      {/* Agent Details */}
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
          </div>

          {/* Sidebar - 1/3 */}
          <div className="lg:w-1/3 space-y-6">
            {/* Animated Education Cards */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-[0_1px_0_rgba(15,23,42,0.04)] overflow-hidden">
              <div className="p-5 border-b border-slate-100 flex items-center gap-2.5">
                <BrandMark size={14} />
                <h3 className="font-bold text-slate-900 text-base tracking-tight">What is Pre-Market?</h3>
              </div>
              <div className="p-6">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeEducationCard}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.3 }}
                    className="mb-4"
                  >
                    {(() => {
                      const Icon = BUYER_EDUCATION[activeEducationCard].Icon;
                      return (
                        <Icon className="w-7 h-7 text-[#e48900] mb-5" strokeWidth={1.75} />
                      );
                    })()}
                    <h4 className="font-bold text-slate-900 mb-2 text-lg tracking-tight">{BUYER_EDUCATION[activeEducationCard].title}</h4>
                    <p className="text-slate-600 text-sm leading-relaxed">{BUYER_EDUCATION[activeEducationCard].description}</p>
                  </motion.div>
                </AnimatePresence>

                {/* Dots indicator */}
                <div className="flex justify-center gap-2 mt-6">
                  {BUYER_EDUCATION.map((_, index) => (
                    <button
                      key={index}
                      onClick={() => setActiveEducationCard(index)}
                      className={`h-1.5 rounded-full transition-all ${
                        index === activeEducationCard ? 'w-6 bg-[#e48900]' : 'w-1.5 bg-slate-200'
                      }`}
                      aria-label={`Show card ${index + 1}`}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Why Homeowners Use Premarket */}
            <div className="relative bg-white rounded-2xl p-6 border border-slate-200 shadow-[0_1px_0_rgba(15,23,42,0.04)] overflow-hidden">
              <div className="absolute -top-10 -right-10 opacity-[0.06] pointer-events-none">
                <BrandMark size={140} />
              </div>
              <div className="relative z-10">
                <p className="text-[11px] font-bold text-[#c64500] uppercase tracking-[0.18em] mb-3">For homeowners</p>
                <h3 className="font-bold text-slate-900 text-lg mb-4 tracking-tight">Why Homeowners Use Premarket</h3>
                <ul className="space-y-3 text-sm text-slate-700">
                  {[
                    'Your local agent runs and represents your property',
                    'Collect real buyer price opinions privately',
                    'Find serious buyers without open homes',
                    'Decide to list — or pause — with zero public exposure',
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#e48900] flex-shrink-0 mt-2" />
                      <span className="leading-relaxed">{item}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-slate-500 mt-5 leading-relaxed">
                  Every property is represented by a <strong className="text-slate-900">licensed local agent</strong> — homeowners don&apos;t list directly.
                </p>
              </div>
            </div>

            {/* CTA Card */}
            <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
              <BrandMark size={20} />
              <h3 className="font-bold text-slate-900 text-lg mt-4 mb-2 tracking-tight">Get Notified</h3>
              <p className="text-slate-600 text-sm leading-relaxed mb-5">
                Create a free buyer account and be the first to know when new properties become available in your areas.
              </p>
              <a
                href="/signup"
                className="inline-flex items-center justify-center gap-2 w-full text-center py-3 bg-[#e48900] text-white text-sm font-semibold rounded-full hover:bg-[#c64500] active:scale-[0.98] transition-all"
              >
                Create free account
              </a>
            </div>

          </div>
        </div>
      </div>

      <FooterLarge />
    </div>
  );
}

export default function ListingsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-white flex flex-col items-center justify-center">
        <BrandMark size={36} loading />
        <p className="mt-4 text-xs font-semibold text-slate-500 uppercase tracking-[0.18em]">Loading</p>
      </div>
    }>
      <ListingsContent />
    </Suspense>
  );
}
