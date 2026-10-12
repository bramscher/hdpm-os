/**
 * Where to send someone after sign-in. Only same-site paths are honoured —
 * "//evil.com" and "/\evil.com" are protocol-relative tricks a browser treats
 * as another host, so anything but a plain "/path" falls back to home.
 */
export function safeCallbackPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  if (raw.startsWith('/login')) return '/';
  return raw;
}
