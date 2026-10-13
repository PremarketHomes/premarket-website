'use client';

import { useEffect, useRef, useCallback } from 'react';

/**
 * Track property engagement metrics.
 * Starts a view timer on mount, tracks scroll depth, and sends data on unmount/navigate.
 *
 * Usage:
 *   const { trackPhotoView, trackShare, trackOpinionStart, trackSubmitAttempted, trackOpinionComplete } = usePropertyEngagement(propertyId, apiKey);
 *
 * trackOpinionStart, trackSubmitAttempted and trackOpinionComplete are
 * three distinct funnel stages — see engagement-ping/route.js for why
 * that distinction matters. Call trackOpinionStart on the buyer's first
 * genuine slider interaction (not on mount, not at submit time).
 */
export function usePropertyEngagement(propertyId, apiKey) {
  const startTime = useRef(Date.now());
  const maxScrollDepth = useRef(0);
  const photosViewed = useRef(0);
  const shared = useRef(false);
  const opinionStarted = useRef(false);
  const submitAttempted = useRef(false);
  const opinionCompleted = useRef(false);
  const sent = useRef(false);
  const sessionId = useRef(
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

  // Send engagement data
  const flush = useCallback(() => {
    if (sent.current || !propertyId) return;
    sent.current = true;

    const data = {
      propertyId,
      sessionId: sessionId.current,
      viewDurationMs: Date.now() - startTime.current,
      scrollDepthPercent: maxScrollDepth.current,
      photosViewed: photosViewed.current,
      shared: shared.current,
      opinionStarted: opinionStarted.current,
      submitAttempted: submitAttempted.current,
      opinionCompleted: opinionCompleted.current,
      platform: 'web',
    };

    // Use fetch with keepalive for reliability on page unload. Path
    // deliberately avoids the word "track" — see engagement-ping/route.js.
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['x-api-key'] = apiKey;

    fetch('/api/v1/engagement-ping', {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
      keepalive: true,
    }).catch(() => {});
  }, [propertyId, apiKey]);

  // Track scroll depth
  useEffect(() => {
    if (!propertyId) return;

    const handleScroll = () => {
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (docHeight > 0) {
        const depth = Math.round((scrollTop / docHeight) * 100);
        if (depth > maxScrollDepth.current) {
          maxScrollDepth.current = depth;
        }
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [propertyId]);

  // Send on unmount / beforeunload
  useEffect(() => {
    if (!propertyId) return;

    const handleUnload = () => flush();
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      flush();
    };
  }, [propertyId, flush]);

  const trackPhotoView = useCallback(() => {
    photosViewed.current++;
  }, []);

  const trackShare = useCallback(() => {
    shared.current = true;
  }, []);

  const trackOpinionStart = useCallback(() => {
    opinionStarted.current = true;
  }, []);

  const trackSubmitAttempted = useCallback(() => {
    submitAttempted.current = true;
  }, []);

  const trackOpinionComplete = useCallback(() => {
    opinionCompleted.current = true;
  }, []);

  return { trackPhotoView, trackShare, trackOpinionStart, trackSubmitAttempted, trackOpinionComplete };
}
