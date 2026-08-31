/**
 * Passkey (WebAuthn) auth for the Dez operator seat.
 *
 * AppFolio's 2-Step Verification offers only SMS *or* passkeys — there is NO
 * authenticator-app (TOTP) option — so a headless bot cannot mint 2FA codes from
 * a shared secret. Instead we register ONE passkey against a Chromium *virtual
 * authenticator* (the CDP `WebAuthn` domain) whose private key WE hold, store
 * that credential as a secret (`APPFOLIO_DEZ_PASSKEY`), and re-attach it on every
 * login so the WebAuthn assertion is satisfied with no human and no phone.
 *
 * Register once with `src/register-passkey.ts`; replay it here forever. The
 * credential is portable — nothing is bound to any physical device or keychain.
 */

import type { CDPSession, Page } from 'playwright';

export interface PasskeyCredential {
  /** base64 (as CDP emits/consumes it) */
  credentialId: string;
  /** base64 PKCS#8 private key */
  privateKey: string;
  /** relying-party id, e.g. "highdesertpm.appfolio.com" or "appfolio.com" */
  rpId: string;
  /** base64 user handle, if the RP set one */
  userHandle?: string;
  signCount?: number;
}

/** Load the stored passkey from `APPFOLIO_DEZ_PASSKEY` (base64 of the JSON). */
export function loadPasskey(): PasskeyCredential {
  const raw = process.env.APPFOLIO_DEZ_PASSKEY;
  if (!raw) {
    throw new Error(
      'APPFOLIO_DEZ_PASSKEY must be set (base64 of the passkey JSON — run `npm run register-passkey`)'
    );
  }
  let cred: PasskeyCredential;
  try {
    // Strip any whitespace/newlines a copy-paste into a host's env UI may inject.
    cred = JSON.parse(Buffer.from(raw.replace(/\s+/g, ''), 'base64').toString('utf8'));
  } catch {
    throw new Error('APPFOLIO_DEZ_PASSKEY is not valid base64-encoded JSON');
  }
  if (!cred.credentialId || !cred.privateKey || !cred.rpId) {
    throw new Error('APPFOLIO_DEZ_PASSKEY is missing credentialId / privateKey / rpId');
  }
  return cred;
}

/**
 * Attach a virtual authenticator to `page`'s browser context (over a CDP session)
 * and, when `credential` is given, preload it so login assertions succeed. Keep
 * the returned CDP session alive for as long as the authenticator is needed —
 * detaching it removes the authenticator.
 *
 * With no `credential` the authenticator is empty and the *site* creates one on
 * it (registration) — that credential is then read back with `exportCredential`.
 */
export async function attachVirtualAuthenticator(
  page: Page,
  credential?: PasskeyCredential
): Promise<{ cdp: CDPSession; authenticatorId: string }> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal', // platform authenticator (Touch-ID-like), matches AppFolio's passkey prompt
      hasResidentKey: true, // discoverable credential — required for usernameless passkey login
      hasUserVerification: true,
      isUserVerified: true, // auto-satisfy user verification (no biometric prompt)
      automaticPresenceSimulation: true, // auto-satisfy user presence (no touch)
    },
  });

  if (credential) {
    await cdp.send('WebAuthn.addCredential', {
      authenticatorId,
      credential: {
        credentialId: credential.credentialId,
        isResidentCredential: true,
        rpId: credential.rpId,
        privateKey: credential.privateKey,
        userHandle: credential.userHandle,
        // Present counter 0 = "authenticator has no signature counter", which
        // tells the RP (Keycloak) not to enforce counter monotonicity. We
        // re-attach a fresh authenticator on every login, so a stored non-zero
        // counter would look like a rewind and get rejected ("passkey invalid").
        signCount: 0,
      },
    });
  }

  return { cdp, authenticatorId };
}

/** Read back the (first) credential the site registered on the virtual authenticator. */
export async function exportCredential(
  cdp: CDPSession,
  authenticatorId: string
): Promise<PasskeyCredential> {
  const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
  if (!credentials.length) {
    throw new Error('no credential was registered on the virtual authenticator');
  }
  const c = credentials[0];
  if (!c.rpId) {
    throw new Error('registered credential has no rpId — cannot replay it for login');
  }
  return {
    credentialId: c.credentialId,
    privateKey: c.privateKey,
    rpId: c.rpId,
    userHandle: c.userHandle,
    signCount: c.signCount,
  };
}

/** Encode a credential the way `APPFOLIO_DEZ_PASSKEY` expects: base64 of the JSON. */
export function encodePasskey(cred: PasskeyCredential): string {
  return Buffer.from(JSON.stringify(cred), 'utf8').toString('base64');
}
