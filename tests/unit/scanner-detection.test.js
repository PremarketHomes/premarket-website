import { describe, it, expect } from 'vitest';
import { isLikelyScanner } from '../../src/app/utils/scannerDetection';

describe('isLikelyScanner', () => {
  it('flags known search engine crawlers', () => {
    expect(isLikelyScanner('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true);
    expect(isLikelyScanner('Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)')).toBe(true);
  });

  it('flags known social/messaging link-preview scanners', () => {
    expect(isLikelyScanner('facebookexternalhit/1.1')).toBe(true);
    expect(isLikelyScanner('Slackbot-LinkExpanding 1.0')).toBe(true);
    expect(isLikelyScanner('WhatsApp/2.23.20.0')).toBe(true);
    expect(isLikelyScanner('TelegramBot (like TwitterBot)')).toBe(true);
  });

  it('flags generic scripted HTTP clients', () => {
    expect(isLikelyScanner('curl/8.4.0')).toBe(true);
    expect(isLikelyScanner('python-requests/2.31.0')).toBe(true);
    expect(isLikelyScanner('axios/1.6.0')).toBe(true);
  });

  it('treats a missing or empty User-Agent as suspicious', () => {
    expect(isLikelyScanner('')).toBe(true);
    expect(isLikelyScanner(undefined)).toBe(true);
    expect(isLikelyScanner(null)).toBe(true);
  });

  it('never flags a genuine desktop browser UA', () => {
    const chrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
    const safari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
    const firefox = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0';
    expect(isLikelyScanner(chrome)).toBe(false);
    expect(isLikelyScanner(safari)).toBe(false);
    expect(isLikelyScanner(firefox)).toBe(false);
  });

  it('never flags a genuine mobile browser UA', () => {
    const androidChrome = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';
    const iosSafari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
    expect(isLikelyScanner(androidChrome)).toBe(false);
    expect(isLikelyScanner(iosSafari)).toBe(false);
  });
});
