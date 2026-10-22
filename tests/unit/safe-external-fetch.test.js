import { describe, it, expect, vi, beforeEach } from 'vitest';

const lookupMock = vi.fn();
vi.mock('node:dns', () => ({
  default: { promises: { lookup: lookupMock } },
  promises: { lookup: lookupMock },
}));

function resolvesTo(...addresses) {
  lookupMock.mockResolvedValue(addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })));
}

describe('safeFetchExternalImage — SSRF protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('rejects a non-http(s) protocol before ever resolving DNS', async () => {
    const { safeFetchExternalImage, UnsafeUrlError } = await import('../../src/app/api/services/safeExternalFetch');
    await expect(safeFetchExternalImage('file:///etc/passwd')).rejects.toThrow(UnsafeUrlError);
    expect(lookupMock).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects an unparsable URL', async () => {
    const { safeFetchExternalImage, UnsafeUrlError } = await import('../../src/app/api/services/safeExternalFetch');
    await expect(safeFetchExternalImage('not a url')).rejects.toThrow(UnsafeUrlError);
  });

  it.each([
    ['127.0.0.1', 'loopback'],
    ['10.0.0.5', 'private 10.x'],
    ['172.16.0.1', 'private 172.16-31.x'],
    ['192.168.1.1', 'private 192.168.x'],
    ['169.254.169.254', 'link-local / cloud metadata'],
    ['::1', 'IPv6 loopback'],
    ['fd00::1', 'IPv6 unique-local'],
  ])('SECURITY: rejects a hostname resolving to %s (%s), never calling fetch', async (ip) => {
    resolvesTo(ip);
    const { safeFetchExternalImage, UnsafeUrlError } = await import('../../src/app/api/services/safeExternalFetch');
    await expect(safeFetchExternalImage('https://attacker.example.com/logo.png')).rejects.toThrow(UnsafeUrlError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('SECURITY: rejects if ANY resolved address is private, even if another is public (DNS rebinding defense)', async () => {
    resolvesTo('93.184.216.34', '127.0.0.1');
    const { safeFetchExternalImage, UnsafeUrlError } = await import('../../src/app/api/services/safeExternalFetch');
    await expect(safeFetchExternalImage('https://example.com/logo.png')).rejects.toThrow(UnsafeUrlError);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fetches successfully for a genuinely public address', async () => {
    resolvesTo('93.184.216.34');
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map([['content-length', '10']]),
      body: { getReader: () => ({ read: vi.fn().mockResolvedValueOnce({ done: false, value: new Uint8Array([1, 2, 3]) }).mockResolvedValueOnce({ done: true }) }) },
    });
    const { safeFetchExternalImage } = await import('../../src/app/api/services/safeExternalFetch');
    const buffer = await safeFetchExternalImage('https://example.com/logo.png');
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBe(3);
  });

  it('SECURITY: re-validates the hostname of a redirect target before following it', async () => {
    resolvesTo('93.184.216.34'); // first hop (public) ...
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 302,
      headers: new Map([['location', 'http://169.254.169.254/secret']]),
    });
    lookupMock.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);
    lookupMock.mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }]); // ...redirect target (private)

    const { safeFetchExternalImage, UnsafeUrlError } = await import('../../src/app/api/services/safeExternalFetch');
    await expect(safeFetchExternalImage('https://example.com/logo.png')).rejects.toThrow(UnsafeUrlError);
    expect(global.fetch).toHaveBeenCalledTimes(1); // never actually fetched the malicious redirect target
  });

  it('a redirect to another public host is followed normally', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);
    lookupMock.mockResolvedValueOnce([{ address: '93.184.216.35', family: 4 }]);
    global.fetch.mockResolvedValueOnce({ ok: false, status: 302, headers: new Map([['location', 'https://cdn.example.com/logo.png']]) });
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Map(),
      body: { getReader: () => ({ read: vi.fn().mockResolvedValueOnce({ done: true }) }) },
    });
    const { safeFetchExternalImage } = await import('../../src/app/api/services/safeExternalFetch');
    const buffer = await safeFetchExternalImage('https://example.com/logo.png');
    expect(buffer.length).toBe(0);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects a response whose Content-Length exceeds the size cap', async () => {
    resolvesTo('93.184.216.34');
    global.fetch.mockResolvedValue({ ok: true, status: 200, headers: new Map([['content-length', String(50 * 1024 * 1024)]]) });
    const { safeFetchExternalImage } = await import('../../src/app/api/services/safeExternalFetch');
    await expect(safeFetchExternalImage('https://example.com/huge.png')).rejects.toThrow(/too large/i);
  });

  it('aborts and rejects a stream that exceeds the size cap even with no Content-Length', async () => {
    resolvesTo('93.184.216.34');
    const bigChunk = new Uint8Array(9 * 1024 * 1024);
    const cancel = vi.fn();
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map(),
      body: { getReader: () => ({ read: vi.fn().mockResolvedValueOnce({ done: false, value: bigChunk }), cancel }) },
    });
    const { safeFetchExternalImage } = await import('../../src/app/api/services/safeExternalFetch');
    await expect(safeFetchExternalImage('https://example.com/huge.png')).rejects.toThrow(/too large/i);
    expect(cancel).toHaveBeenCalled();
  });

  it('rejects an unresolvable hostname rather than silently proceeding', async () => {
    lookupMock.mockRejectedValue(new Error('ENOTFOUND'));
    const { safeFetchExternalImage, UnsafeUrlError } = await import('../../src/app/api/services/safeExternalFetch');
    await expect(safeFetchExternalImage('https://this-does-not-resolve.example/logo.png')).rejects.toThrow(UnsafeUrlError);
  });

  it('surfaces a plain error (not UnsafeUrlError) for a genuine HTTP failure from a safe host', async () => {
    resolvesTo('93.184.216.34');
    global.fetch.mockResolvedValue({ ok: false, status: 404, headers: new Map() });
    const { safeFetchExternalImage, UnsafeUrlError } = await import('../../src/app/api/services/safeExternalFetch');
    await expect(safeFetchExternalImage('https://example.com/missing.png')).rejects.not.toThrow(UnsafeUrlError);
  });
});
