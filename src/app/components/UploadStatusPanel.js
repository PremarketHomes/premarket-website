'use client';

import { useEffect, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Loader2, CheckCircle2, AlertTriangle, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { subscribe, getJobs, restoreJobs, resumeJob, dismissJob, hasActiveUploads } from '../utils/mediaUploadManager';

const EMPTY = [];

/**
 * Persistent upload status (mounted once in the root layout, so it stays visible on every page).
 * Honest by design: uploads only run while this browser tab is open and awake. Closing the browser or sleeping the
 * computer pauses them; finished files are kept and the rest wait for Resume.
 */
export default function UploadStatusPanel() {
  const { user } = useAuth();
  const all = useSyncExternalStore(subscribe, getJobs, () => EMPTY);
  const jobs = all.filter((j) => user && j.userId === user.uid);

  useEffect(() => { if (user) restoreJobs(); }, [user]);
  useEffect(() => {
    const warn = (e) => { if (hasActiveUploads()) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  // Completed notices clear themselves.
  useEffect(() => {
    const t = jobs.filter((j) => j.status === 'complete').map((j) => setTimeout(() => dismissJob(j.id), 15000));
    return () => t.forEach(clearTimeout);
  }, [jobs.map((j) => `${j.id}:${j.status}`).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!jobs.length) return null;
  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-96 z-[80] space-y-2" aria-live="polite">
      {jobs.map((j) => (
        <div key={j.id} className="rounded-xl border border-stone-200 bg-white shadow-lg p-3.5 text-sm">
          <div className="flex items-start gap-2.5">
            {j.status === 'uploading' || j.status === 'queued' ? <Loader2 className="w-4 h-4 mt-0.5 animate-spin text-[#c64500] shrink-0" />
              : j.status === 'complete' ? <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-600 shrink-0" />
              : <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-600 shrink-0" />}
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-stone-900 truncate">{j.label}</p>
              <p className="text-stone-600">
                {j.status === 'complete' ? j.message
                  : j.status === 'uploading' || j.status === 'queued' ? `Uploading ${Math.min(j.done + 1, j.total)} of ${j.total}. You can keep using Premarket, but keep this tab open.`
                  : `${j.remaining} of ${j.total} file${j.total === 1 ? '' : 's'} still to upload. ${j.message}`}
              </p>
              {j.status !== 'complete' && (
                <div className="mt-2 h-1.5 rounded-full bg-stone-100 overflow-hidden"><div className="h-full bg-[#c64500] transition-all duration-300" style={{ width: `${Math.round(j.progress * 100)}%` }} /></div>
              )}
              {j.status === 'interrupted' && (
                <p className="mt-1.5 text-xs text-stone-500">Closing the browser or putting the computer to sleep pauses uploads. Finished files are saved. Reopen Premarket on this computer to resume.</p>
              )}
              <div className="mt-2 flex gap-3">
                {j.status === 'interrupted' && <button onClick={() => resumeJob(j.id)} className="font-semibold text-[#c64500] hover:underline">Resume</button>}
                {j.status === 'complete' && j.redirectTo && <Link href={j.redirectTo} className="font-semibold text-[#c64500] hover:underline">View</Link>}
                {(j.status === 'interrupted' || j.status === 'error') && (
                  <button onClick={() => { if (window.confirm('Discard the files that have not uploaded yet?')) dismissJob(j.id); }} className="text-stone-500 hover:underline">Discard</button>
                )}
              </div>
            </div>
            {(j.status === 'complete') && (
              <button onClick={() => dismissJob(j.id)} aria-label="Dismiss" className="text-stone-400 hover:text-stone-700"><X className="w-4 h-4" /></button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
