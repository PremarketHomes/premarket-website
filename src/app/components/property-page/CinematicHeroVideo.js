'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * The muted, looping "moving hero" layer that sits over the static hero
 * image once a property video exists.
 *
 * The image is the loading/fallback state, always. This never reveals
 * itself until the browser has actually started rendering frames (the
 * native `playing` event) — never merely because `canplay` fired, and
 * never by relying on the declarative `autoplay` attribute, which is
 * exactly what caused the original bug: Safari's own "autoplay was
 * blocked" affordance (a large native play glyph) rendering over an
 * already-revealed-but-paused video. Playback is instead driven
 * entirely by an explicit, imperative `video.play()` call, so a
 * rejection is something we can catch and simply not reveal for,
 * rather than a silent browser decision we have no hook into.
 *
 * `muted`/`defaultMuted`/`playsInline` are set as real DOM properties on
 * the element the instant it exists (a callback ref, not a post-mount
 * effect) — not left to React's JSX-attribute diffing, which can lose
 * the muted-autoplay race in Safari if `src` and `muted` don't land on
 * the node in the same tick.
 *
 * The hero is above the fold, so loading begins as soon as this mounts
 * — no IntersectionObserver gate on that. IntersectionObserver is still
 * used, but only to pause/resume playback when the hero scrolls
 * off/back into view, and to stop a backgrounded tab from playing.
 *
 * If autoplay never succeeds (or the video errors), `ready` simply never
 * becomes true: the image stays visible, and "Watch video" remains the
 * fallback way to see it. Hero video is an enhancement, never a
 * requirement.
 */
export default function CinematicHeroVideo({ src, paused = false }) {
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const [reducedMotion, setReducedMotion] = useState(true); // safe default until checked
  const [inView, setInView] = useState(true); // above the fold — assume visible until told otherwise
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

  // Pause/resume on scroll only — never gates whether the video loads or
  // gets its first play attempt.
  useEffect(() => {
    if (reducedMotion || errored || !containerRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.25 }
    );
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [reducedMotion, errored]);

  const setVideoNode = useCallback((node) => {
    videoRef.current = node;
    if (node) {
      // Real DOM properties, set synchronously as the node is created —
      // before the browser has any chance to evaluate autoplay policy
      // against it.
      node.muted = true;
      node.defaultMuted = true;
      node.playsInline = true;
    }
  }, []);

  const attemptPlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const playPromise = video.play();
    // A muted, script-invoked play() can still be rejected (interrupted
    // by a near-simultaneous pause(), not enough data yet, etc). That's
    // fine — the cover image is already showing, and `ready` only ever
    // becomes true from the `playing` event below, never from here.
    playPromise?.catch?.(() => {});
  }, []);

  // The single source of truth for revealing the video: an actual frame
  // has actually rendered. Not canplay, not a resolved play() promise —
  // both can fire without the browser having genuinely started playback.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || reducedMotion || errored) return;
    const handlePlaying = () => setReady(true);
    video.addEventListener('playing', handlePlaying);
    return () => video.removeEventListener('playing', handlePlaying);
  }, [reducedMotion, errored, src]);

  // First (and any subsequent) play attempt. Runs as soon as src/paused/
  // inView settle into a playable state — no waiting on canplay first;
  // the browser queues play() internally until it has enough data.
  useEffect(() => {
    if (reducedMotion || errored || !src || paused || !inView) return;
    attemptPlay();
  }, [reducedMotion, errored, src, paused, inView, attemptPlay]);

  useEffect(() => {
    const handleVisibility = () => {
      const video = videoRef.current;
      if (!video) return;
      if (document.hidden || paused || !inView) video.pause();
      else attemptPlay();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [inView, paused, attemptPlay]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (paused || !inView || document.hidden) video.pause();
    else attemptPlay();
  }, [paused, inView, attemptPlay]);

  if (reducedMotion || errored || !src) return null;

  return (
    <div ref={containerRef} className="absolute inset-0" aria-hidden="true">
      <video
        ref={setVideoNode}
        src={src}
        preload="auto"
        muted
        loop
        playsInline
        controls={false}
        disablePictureInPicture
        onError={() => setErrored(true)}
        className={`absolute inset-0 w-full h-full object-cover pointer-events-none transition-opacity duration-700 ease-out ${
          ready ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </div>
  );
}
