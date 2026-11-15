import { supabase } from '../lib/supabase';
import { readStorage, writeStorage } from '../lib/safeStorage';

export type PushStatus = 'unsupported' | 'ios-install' | 'blocked' | 'off' | 'on';
const PUSH_OFF_KEY = 'sweet_push_off';

export type PermissionType = 'microphone' | 'camera' | 'notifications'| 'location';
export type PermissionStatus = 'granted' | 'denied' | 'prompt';

class PermissionManagerService {
  /**
   * Checks the current status of a permission without prompting the user
   */
  async checkPermission(type: PermissionType): Promise<PermissionStatus> {
    if (type === 'notifications') {
      if (!('Notification' in window)) return 'denied';
      return Notification.permission as PermissionStatus;
    }

    try {
      if (navigator.permissions && navigator.permissions.query) {
        const name = type === 'microphone' ? 'microphone' : 'camera';
        const result = await navigator.permissions.query({ name: name as PermissionName });
        return result.state as PermissionStatus;
      }
    } catch (e) {
      console.warn("Permissions API not fully supported, defaulting to manual check.");
    }

    return 'prompt';
  }

  /**
   * Requests a specific permission just-in-time when a feature is used
   */
  async requestPermission(type: PermissionType, userId?: string): Promise<boolean> {
    const currentStatus = await this.checkPermission(type);
    if (currentStatus === 'granted') return true;
    if (currentStatus === 'denied') {
      // Deliberately no alert() here — a service class shouldn't own UI.
      // The caller checks this false return and shows its own message via
      // the shared toast system (see StrictLock's use of this).
      return false;
    }

    if (type === 'notifications') {
      if (!('Notification' in window)) return false;
      const permission = await Notification.requestPermission();
      
      if (permission === 'granted' && userId) {
        await this.setupPushSubscription(userId);
      }
      return permission === 'granted';
    }

    if (type === 'microphone') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        return true;
      } catch (err) {
        return false;
      }
    }

    if (type === 'camera') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        stream.getTracks().forEach(track => track.stop());
        return true;
      } catch (err) {
        return false;
      }
    }

    return false;
  }

  /**
   * The service worker main.tsx registered (registerSW from vite-plugin-pwa).
   * Never registers one itself: in dev the worker lives at /dev-sw.js, so a
   * hard-coded register('/sw.js') failed on localhost.
   */
  private async readyRegistration(timeoutMs = 10000): Promise<ServiceWorkerRegistration | null> {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
    const existing = await navigator.serviceWorker.getRegistration();
    // Only usable once a worker is ACTIVE — subscribing while it is still
    // installing (first visit) throws "no active Service Worker".
    if (existing?.active) return existing;
    return Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
  }

  /** This device's push subscription, or null (no worker / not subscribed). */
  public async currentSubscription(): Promise<PushSubscription | null> {
    const registration = await this.readyRegistration(5000);
    return (await registration?.pushManager.getSubscription()) ?? null;
  }

  /** True when the app's service worker is installed and running. */
  public async workerReady(): Promise<boolean> {
    const registration = await this.readyRegistration(8000);
    return !!registration?.active;
  }

  /**
   * Sign-out: stop this device getting the signed-out account's messages.
   * Removes the server row only — the browser keeps its subscription, so the
   * next account to sign in here re-registers it instantly. Never takes
   * longer than `timeoutMs` (sign-out must not hang when offline).
   */
  public async forgetDeviceOnServer(timeoutMs = 4000): Promise<void> {
    let subscription: PushSubscription | null = null;
    const work = (async () => {
      subscription = await this.currentSubscription();
      if (!subscription) return true;
      const { error } = await supabase.rpc('unregister_push_device', { p_endpoint: subscription.endpoint });
      return !error;
    })().catch(() => false);
    const forgotten = await Promise.race([work, new Promise<false>((resolve) => setTimeout(() => resolve(false), timeoutMs))]);
    if (!forgotten && subscription) {
      // Offline or the session already expired, so the server still has this
      // device under the old account. Kill the browser's push address instead:
      // the next send gets 410 and the server deletes the row itself.
      try { await (subscription as PushSubscription).unsubscribe(); } catch { /* already gone */ }
    }
  }

  /** The user turned background notifications off on THIS device. */
  public isPushOptedOut(): boolean {
    return readStorage(PUSH_OFF_KEY) === '1';
  }

  /**
   * Where this device stands, for the Settings switch:
   *  unsupported  — no push in this browser at all
   *  ios-install  — iPhone/iPad Safari: only works once added to the Home Screen
   *  blocked      — the user said "Block"; only the browser can undo it
   *  off          — allowed (or never asked) but this device isn't subscribed
   *  on           — subscribed and not opted out
   */
  public async getPushStatus(): Promise<PushStatus> {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      return ios && !standalone ? 'ios-install' : 'unsupported';
    }
    if (Notification.permission === 'denied') return 'blocked';
    if (Notification.permission !== 'granted' || this.isPushOptedOut()) return 'off';
    const registration = await this.readyRegistration(3000);
    const subscription = await registration?.pushManager.getSubscription();
    return subscription ? 'on' : 'off';
  }

  /** The master switch, turned on by a tap. Asks for permission if needed. */
  public async enablePush(userId: string): Promise<PushStatus | 'failed'> {
    const status = await this.getPushStatus();
    if (status === 'unsupported' || status === 'ios-install' || status === 'blocked') return status;
    if (Notification.permission !== 'granted') {
      const permission = await Notification.requestPermission();
      if (permission === 'denied') return 'blocked';
      if (permission !== 'granted') return 'off';
    }
    writeStorage(PUSH_OFF_KEY, '0');
    return (await this.setupPushSubscription(userId, { userAction: true })) ? 'on' : 'failed';
  }

  /** The master switch, turned off: this device only, and it stays off. */
  public async disablePush(): Promise<void> {
    writeStorage(PUSH_OFF_KEY, '1');
    await this.removePushSubscription();
  }

  /**
   * Saves push credentials safely to Supabase. Returns true when this device
   * is registered. Background re-syncs (app start, browser rotation) skip a
   * device the user switched off; a tap on the switch passes userAction.
   */
  public async setupPushSubscription(_userId: string, opts: { userAction?: boolean } = {}): Promise<boolean> {
    if (!opts.userAction && this.isPushOptedOut()) return false;
    try {
      const registration = await this.readyRegistration();
      if (!registration) return false;

      let subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        // HERE IS THE VAPID KEY LINE! 🌟
        // Replace this string placeholder once you generate your keys
        const PUBLIC_VAPID_KEY = 'BN0W_LXpb4i6T9LLvIcl09EMbXoHpfxirqLvsN0rQMZWN9exQCO5r-ZLmh5CDnYZJki3tiBOdFITErKH9nBxf-I'; 
        
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          // Ensure we pass an ArrayBuffer (BufferSource) to satisfy TS types for PushManager
          applicationServerKey: this.urlBase64ToUint8Array(PUBLIC_VAPID_KEY).buffer as ArrayBuffer
        });
      }

      // One row per device (keyed by the push endpoint), saved through an RPC
      // so a browser that someone else used before is taken over by whoever
      // is signed in now. The server uses the signed-in user,
      // not the id passed in.
      const { error } = await supabase.rpc('register_push_device', {
        p_subscription: subscription.toJSON(),
        p_label: this.deviceLabel(),
      });

      if (error) throw error;
      return true;
    } catch (err) {
      console.error("Failed to complete push subscription pipeline:", err);
      return false;
    }
  }

  /**
   * Stops background pushes to THIS device only: forgets it on the server
   * and drops the browser subscription. Other devices keep working.
   */
  public async removePushSubscription(): Promise<void> {
    const registration = await this.readyRegistration(3000);
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;
    const { error } = await supabase.rpc('unregister_push_device', { p_endpoint: subscription.endpoint });
    if (error) console.error('Failed to forget this device:', error);
    await subscription.unsubscribe();
  }

  /**
   * Forgets one push address on the server (best-effort). Used whenever an
   * address is replaced — otherwise the old one stays listed as a "ghost"
   * device until a push to it happens to fail.
   */
  public async forgetEndpoint(endpoint: string): Promise<void> {
    const { error } = await supabase.rpc('unregister_push_device', { p_endpoint: endpoint });
    if (error) console.error('Failed to forget an old push address:', error);
  }

  /** "Chrome on Android" — shown in the device list, never used for logic. */
  private deviceLabel(): string {
    const ua = navigator.userAgent;
    const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
      : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iPhone' : /Windows/.test(ua) ? 'Windows'
      : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'device';
    return `${browser} on ${os}`;
  }

  /**
   * Helper utility to format security strings for push cryptographic handshakes
   */
  private urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }
}

export const PermissionManager = new PermissionManagerService();