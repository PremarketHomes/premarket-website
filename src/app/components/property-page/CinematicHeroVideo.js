'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The muted, looping "moving hero" layer that sits over the static hero
 * image once a property video exists. Deliberately conservative about
 * when it does anything:
 *
 * - Never mounts a <video src> until the hero is actually scrolled into
 *   view (IntersectionObserver) — a property page with a video shouldn't
 *   cost a single video byte for a buyer who never gets that far.
 * - Never attempts anything at all if the visitor has requested reduced
 *   motion — the static hero image is the correct experience there.
 * - Stays fully transparent (opacity-0) until the browser reports the
 *   video has enough buffered to play through smoothly (`canplay`), then
 *   crossfades in. The underlying hero <img> never unmounts or changes,
 *   so any failure at any point (bad URL, unsupported codec, slow
 *   connection, autoplay blocked) just leaves the image showing — there
 *   is no failure state to render, only an enhancement that may or may
 *   not arrive.
 * - Pauses on scroll-away and on a backgrounded tab; resumes when both
 *   back in view and the tab is visible again, unless `paused` (the
 *   "Watch video" modal is open) says otherwise.
 */
export default function CinematicHeroVideo({ src, paused = false }) {
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const [reducedMotion, setReducedMotion] = useState(true); // safe default until checked
  const [inView, setInView] = useState(false);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [ready, setReady] = useState(false);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const handler = (e) => setReducedMotion(e.matches);
    mq.addEventListener?.('change', handler);
    return () => mq.removeEventListener?.('change', handler);
  }, []);

  useEffect(() => {
    if (reducedMotion || errored || !containerRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setInView(entry.isIntersecting);
        if (entry.isIntersecting) setShouldLoad(true);
      },
      { threshold: 0.25 }
    );
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [reducedMotion, errored]);

  useEffect(() => {
    const handleVisibility = () => {
      const video = videoRef.current;
      if (!video || !ready) return;
      if (document.hidden || paused || !inView) video.pause();
      else video.play().catch(() => {});
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [inView, ready, paused]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !ready) return;
    if (paused || !inView || document.hidden) video.pause();
    else video.play().catch(() => {}); // autoplay can still be blocked — fine, image stays visible underneath
  }, [paused, inView, ready]);

  if (reducedMotion || errored || !src) return null;

  return (
    <div ref={containerRef} className="absolute inset-0" aria-hidden="true">
      <video
        ref={videoRef}
        src={shouldLoad ? src : undefined}
        preload="metadata"
        muted
        loop
        playsInline
        autoPlay
        onCanPlay={() => setReady(true)}
        onError={() => setErrored(true)}
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ease-out ${
          ready ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </div>
  );
}
