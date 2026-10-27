'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '../../../../context/AuthContext';
import { db } from '../../../../firebase/clientApp';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { ArrowLeft, DollarSign, CheckCircle, Home, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { loginUrlForCurrentPage } from '../../../../utils/loginRedirect';

export default function SoldEntryPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const propertyId = params.id;

  const [property, setProperty] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [soldPrice, setSoldPrice] = useState('');
  const [soldDate, setSoldDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace(loginUrlForCurrentPage());
      return;
    }

    async function fetchProperty() {
      try {
        const propDoc = await getDoc(doc(db, 'properties', propertyId));
        if (!propDoc.exists()) {
          router.push('/dashboard');
          return;
        }
        const data = propDoc.data();
        // Check if user owns this property or is superAdmin
        const isOwner = data.userId === user.uid || data.uid === user.uid;
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        const isSuperAdmin = userDoc.exists() && userDoc.data().superAdmin === true;

        if (!isOwner && !isSuperAdmin) {
          router.push('/dashboard');
          return;
        }

        setProperty({ id: propDoc.id, ...data });

        // If already sold, pre-fill the data
        if (data.soldPrice) {
          setSoldPrice(String(data.soldPrice));
        }
        if (data.soldAt) {
          const d = data.soldAt?.toDate?.() || new Date(data.soldAt);
          setSoldDate(d.toISOString().split('T')[0]);
        }
      } catch (err) {
        console.error('Error fetching property:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchProperty();
  }, [user, authLoading, propertyId, router]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!soldPrice || isNaN(parseFloat(soldPrice.replace(/[^0-9.]/g, '')))) {
      alert('Please enter a valid sold price');
      return;
    }

    setSubmitting(true);
    try {
      const cleanPrice = parseFloat(soldPrice.replace(/[^0-9.]/g, ''));
      await updateDoc(doc(db, 'properties', propertyId), {
        soldPrice: cleanPrice,
        soldAt: new Date(soldDate),
        soldNotes: notes || null,
        archived: true,
        active: false,
        archivedAt: serverTimestamp(),
        archivedReason: 'sold',
      });
      setSubmitted(true);
    } catch (err) {
      console.error('Error recording sale:', err);
      alert('Failed to record sale. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-orange-500" />
      </div>
    );
  }

  if (!property) return null;

  const address = property.address || property.formattedAddress || 'Unknown property';

  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-10 h-10 text-emerald-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-3">Sale Recorded</h1>
          <p className="text-slate-600 mb-2">
            <strong>{address}</strong> has been marked as sold and archived.
          </p>
          <p className="text-sm text-slate-400 mb-6">
            Thank you for keeping your listing up to date. This data helps improve market insights for everyone.
          </p>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-orange-500 to-orange-600 text-white font-bold rounded-xl hover:shadow-lg transition-all"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 py-8 px-4">
      <div className="max-w-lg mx-auto">
        {/* Back link */}
        <Link
          href={`/dashboard/property/${propertyId}`}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to property
        </Link>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-emerald-600 to-emerald-700 px-6 py-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
                <Home className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-white">Record Sale</h1>
                <p className="text-emerald-100 text-sm truncate max-w-[280px]">{address}</p>
              </div>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            <p className="text-sm text-slate-500">
              Record the sold price for this property. The listing will be archived and no longer shown to buyers.
            </p>

            {/* Sold Price */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                Sold Price *
              </label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={soldPrice}
                  onChange={(e) => setSoldPrice(e.target.value)}
                  placeholder="e.g. 850000"
                  required
                  className="w-full pl-9 pr-4 py-3 border border-slate-200 rounded-xl text-slate-900 text-lg font-semibold placeholder-slate-300 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none"
                />
              </div>
              <p className="text-xs text-slate-400 mt-1">Enter the final sold amount (numbers only)</p>
            </div>

            {/* Sold Date */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                Sale Date
              </label>
              <input
                type="date"
                value={soldDate}
                onChange={(e) => setSoldDate(e.target.value)}
                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none"
              />
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                Notes <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Any additional details about the sale..."
                className="w-full px-4 py-3 border border-slate-200 rounded-xl text-slate-900 placeholder-slate-300 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none resize-none"
              />
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3.5 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white font-bold rounded-xl shadow-lg hover:shadow-emerald-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Recording...
                </>
              ) : (
                <>
                  <CheckCircle className="w-5 h-5" />
                  Record Sale & Archive
                </>
              )}
            </button>

            <p className="text-xs text-center text-slate-400">
              This action will archive the property and remove it from active listings.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
