'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { isPreviewDeployment } from '../../utils/previewEnvironment';

/**
 * The muted, looping "moving hero" layer that sits over the static hero
 * image once a property video exists.
 *
 * The image is the loading/fallback state, always. This never reveals
 * itself until the browser has actually started rendering frames (the
 * native `playing` event) — never merely because `canplay` fired, and
 * never by relying on the declarative `autoplay` attribute.
 *
 * `muted`/`defaultMuted`/`playsInline` are set as real DOM properties on
 * the element the instant it exists (a callback ref, not a post-mount
 * effect) — not left to React's JSX-attribute diffing.
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
 *
 * TEMPORARY DIAGNOSTICS (2026-09): gated to Preview/dev only via
 * isPreviewDeployment()/NODE_ENV — never runs on premarket.homes
 * production. Logs the media lifecycle (readyState/networkState/every
 * relevant event, the play() promise outcome, and every play()/pause()
 * call site with its reason) to console under the `[HeroVideoDiag]`
 * prefix, to find out exactly why autoplay isn't starting on a real
 * test property. No src/token is ever logged in full. Remove once the
 * root cause is confirmed and fixed, unless kept deliberately.
 */

const DIAG = typeof window !== 'undefined' && (isPreviewDeployment() || process.env.NODE_ENV !== 'production');

function redactSrc(src) {
  if (!src) return src;
  try {
    const u = new URL(src);
    return u.pathname; // strip query string (Firebase download token) entirely
  } catch {
    return '[unparseable-src]';
  }
}

function diag(event, detail) {
  if (!DIAG) return;
  // eslint-disable-next-line no-console
  console.log(`[HeroVideoDiag] ${event}`, {
    t: typeof performance !== 'undefined' ? Math.round(performance.now()) : null,
    ...detail,
  });
}

function videoSnapshot(video) {
  if (!video) return null;
  return {
    muted: video.muted,
    defaultMuted: video.defaultMuted,
    autoplay: video.autoplay,
    playsInline: video.playsInline,
    readyState: video.readyState,
    networkState: video.networkState,
    paused: video.paused,
    currentSrc: redactSrc(video.currentSrc),
    duration: video.duration,
  };
}

export default function CinematicHeroVideo({ src, paused = false }) {
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const [reducedMotion, setReducedMotion] = useState(true); // safe default until checked
  const [inView, setInView] = useState(true); // above the fold — assume visible until told otherwise
  const [ready, setReady] = useState(false);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    diag('component-mount', { src: redactSrc(src), visibilityState: typeof document !== 'undefined' ? document.visibilityState : null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    diag('reduced-motion-check', { matches: mq.matches });
    const handler = (e) => setReducedMotion(e.matches);
    mq.addEventListener?.('change', handler);
    return () => mq.removeEventListener?.('change', handler);
  }, [src]);

  // Pause/resume on scroll only — never gates whether the video loads or
  // gets its first play attempt.
  useEffect(() => {
    if (reducedMotion || errored || !containerRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        diag('intersection-observer', { isIntersecting: entry.isIntersecting, intersectionRatio: entry.intersectionRatio });
        setInView(entry.isIntersecting);
      },
      { threshold: 0.25 }
    );
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [reducedMotion, errored]);

  const setVideoNode = useCallback((node) => {
    videoRef.current = node;
    if (node) {
      node.muted = true;
      node.defaultMuted = true;
      node.playsInline = true;
      diag('video-node-created', videoSnapshot(node));

      if (DIAG) {
        const events = ['loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough', 'play', 'playing', 'pause', 'waiting', 'stalled', 'suspend', 'emptied', 'abort'];
        events.forEach((evt) => {
          node.addEventListener(evt, () => diag(`media-event:${evt}`, videoSnapshot(node)));
        });
        node.addEventListener('error', () => {
          const err = node.error;
          diag('media-event:error', { code: err?.code, message: err?.message, ...videoSnapshot(node) });
        });
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const attemptPlay = useCallback((reason) => {
    const video = videoRef.current;
    if (!video) return;
    diag('attempt-play', { reason, ...videoSnapshot(video) });
    const playPromise = video.play();
    if (playPromise && typeof playPromise.then === 'function') {
      playPromise.then(
        () => diag('play-promise-resolved', { reason, ...videoSnapshot(video) }),
        (err) => diag('play-promise-rejected', { reason, errorName: err?.name, errorMessage: err?.message, ...videoSnapshot(video) })
      );
    } else {
      diag('play-returned-no-promise', { reason });
    }
  }, []);

  const attemptPause = useCallback((reason) => {
    const video = videoRef.current;
    if (!video) return;
    diag('attempt-pause', { reason, ...videoSnapshot(video) });
    video.pause();
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
    attemptPlay('mount-or-deps-effect');
  }, [reducedMotion, errored, src, paused, inView, attemptPlay]);

  useEffect(() => {
    const handleVisibility = () => {
      diag('visibilitychange', { hidden: document.hidden });
      if (document.hidden || paused || !inView) attemptPause('visibilitychange');
      else attemptPlay('visibilitychange');
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [inView, paused, attemptPlay, attemptPause]);

  useEffect(() => {
    if (!videoRef.current) return;
    if (paused || !inView || document.hidden) attemptPause('paused-inview-effect');
    else attemptPlay('paused-inview-effect');
  }, [paused, inView, attemptPlay, attemptPause]);

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
