/**
 * SMS transport seam.
 *
 * HABU principle: Slack is the default chassis, not the identity — channel
 * adapters stay swappable. Core defines the SMS *contract*; a tenant registers
 * the real backend at boot (hdpm-os wires Zoom Phone via `lib/zoom-phone.ts`).
 * Until one is registered, the default transport reports "not configured", so
 * habu-core builds and tests green with zero tenant integration code.
 */

export interface SmsTransport {
  /** True when the backend has the env/credentials it needs to send. */
  isConfigured(): boolean;
  /** Send a text; resolves with the provider message id (or null). */
  send(input: { toPhoneNumber: string; message: string }): Promise<{ messageId: string | null }>;
}

/** The no-op transport installed until a tenant registers a real backend. */
export const defaultSmsTransport: SmsTransport = {
  isConfigured: () => false,
  async send() {
    throw new Error('No SMS transport registered (call registerSmsTransport)');
  },
};

let _transport: SmsTransport = defaultSmsTransport;

/** Tenant boot hook: install the real SMS backend (e.g. Zoom Phone). */
export function registerSmsTransport(transport: SmsTransport): void {
  _transport = transport;
}

export function getSmsTransport(): SmsTransport {
  return _transport;
}
