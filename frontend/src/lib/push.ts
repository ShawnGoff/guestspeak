import { api } from './api';

/**
 * Web push subscription helpers.
 *
 * The awkward part is iOS: Safari only delivers web push to sites the user has
 * added to their Home Screen. Requesting permission in a normal Safari tab does
 * nothing useful, so the UI has to detect that case and explain it rather than
 * showing a toggle that silently fails.
 */

export type PushState =
  | 'unsupported'      // no service worker or Push API (old browser)
  | 'ios-needs-install'// iOS Safari, not yet added to the Home Screen
  | 'denied'           // permission refused; only recoverable in browser settings
  | 'off'              // supported and permitted to ask, not subscribed
  | 'on';              // subscribed

/** iOS home-screen apps report standalone display mode. */
function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    // Safari's own non-standard flag, still the reliable signal on iOS.
    || (window.navigator as unknown as { standalone?: boolean }).standalone === true;
}

function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    // iPadOS 13+ reports as a Mac; touch points disambiguate.
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export async function getPushState(): Promise<PushState> {
  if (typeof window === 'undefined') return 'unsupported';
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    // On iOS this is what a plain Safari tab looks like — the API is simply
    // absent until the site is installed, so say that rather than "unsupported".
    return isIOS() ? 'ios-needs-install' : 'unsupported';
  }
  if (isIOS() && !isStandalone()) return 'ios-needs-install';
  if (Notification.permission === 'denied') return 'denied';

  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

/**
 * The VAPID key arrives base64url-encoded and the Push API wants raw bytes.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);

  // Backed by an explicit ArrayBuffer: applicationServerKey requires a
  // BufferSource over ArrayBuffer, and Uint8Array.from widens to
  // ArrayBufferLike, which also admits SharedArrayBuffer.
  const buffer = new ArrayBuffer(raw.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * Ask permission, subscribe, and register with the server.
 * Returns the resulting state so the caller can render it directly.
 */
export async function enablePush(): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';

  const { key } = await api.get<{ key: string | null }>('/notifications/push/key');
  if (!key) throw new Error('Push is not configured on the server.');

  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    // Chrome refuses silent push outright, and it would be the wrong choice
    // anyway: every notification here is something the user asked to be told.
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key),
  });

  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh: string; auth: string } };
  await api.post('/notifications/push', { endpoint: json.endpoint, keys: json.keys });
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return 'off';

  // Tell the server first. If unsubscribing locally succeeded but the server
  // call failed, we would keep pushing to a dead endpoint until it 410s.
  await api.delete('/notifications/push', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
  return 'off';
}
