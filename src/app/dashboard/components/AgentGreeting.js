'use client';

import { useState } from 'react';
import Link from 'next/link';
import { User } from 'lucide-react';
import { getInitials, isPlaceholderAvatar } from '../../utils/avatar';

/**
 * Mobile dashboard greeting: the agent's own profile photo beside
 * "Welcome back, <first name>", with their office underneath when they belong to one.
 *
 * Uses the profile photo already stored on the user (userData.avatar) — no new upload
 * system. The account-creation placeholder, a missing photo or a photo that fails to
 * load all fall back to a polished initials avatar. The office line never replaces the
 * person's own name; while the office name loads a skeleton holds its place, and if it
 * can't be loaded the line is simply omitted (the greeting itself never shows an error).
 */
export default function AgentGreeting({ userData, officeName, officeStatus, className = '' }) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const firstName = (userData?.firstName || '').trim();
  const initials = getInitials(userData?.firstName, userData?.lastName);
  const showPhoto = !isPlaceholderAvatar(userData?.avatar) && !photoFailed;
  const inOffice = !!userData?.officeId;

  return (
    <div className={`flex items-center gap-3.5 ${className}`}>
      {showPhoto ? (
        <img
          src={userData.avatar}
          alt=""
          onError={() => setPhotoFailed(true)}
          className="w-14 h-14 rounded-full object-cover shrink-0 ring-2 ring-white shadow-md"
        />
      ) : (
        <div
          aria-hidden="true"
          data-testid="initials-avatar"
          className="w-14 h-14 rounded-full shrink-0 flex items-center justify-center bg-orange-100 text-orange-700 font-semibold text-lg tracking-wide ring-2 ring-white shadow-md"
        >
          {initials || <User className="w-6 h-6" />}
        </div>
      )}
      <div className="min-w-0">
        <p className="text-base text-slate-600 leading-snug">
          Welcome back{firstName ? <>, <span className="font-semibold text-slate-900">{firstName}</span></> : ''}
        </p>
        {inOffice ? (
          officeStatus === 'loading' ? (
            <div className="h-3.5 w-28 rounded bg-slate-200 animate-pulse mt-1.5" aria-label="Loading office" />
          ) : officeName ? (
            <p className="text-sm text-slate-500 truncate mt-0.5">{officeName}</p>
          ) : null
        ) : !userData?.companyName ? (
          <Link href="/dashboard/settings" className="text-sm text-orange-500 hover:text-orange-600 font-semibold mt-0.5 inline-block">
            Add agency details
          </Link>
        ) : null}
      </div>
    </div>
  );
}
