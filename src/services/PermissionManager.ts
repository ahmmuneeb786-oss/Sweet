import { supabase } from '../lib/supabase';

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
   * Initializes and registers the background service worker engine safely
   */
  async initializeServiceWorker(): Promise<ServiceWorkerRegistration | null> {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('Push notifications are not supported on this platform/browser configuration.');
      return null;
    }

    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      return registration;
    } catch (error) {
      console.error('Service worker registration failed:', error);
      return null;
    }
  }

  /**
   * Saves push credentials safely to Supabase
   */
  public async setupPushSubscription(userId: string) {
    try {
      const registration = await this.initializeServiceWorker();
      if (!registration) return;

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

      // Sync credential structure to your Supabase profiles table
      const { error } = await supabase
        .from('profiles')
        .update({ push_subscription: JSON.stringify(subscription) })
        .eq('id', userId);

      if (error) throw error;
    } catch (err) {
      console.error("Failed to complete push subscription pipeline:", err);
    }
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