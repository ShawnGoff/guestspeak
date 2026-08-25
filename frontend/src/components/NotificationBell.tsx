'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Notification {
  id: string;
  type: string;
  payload: Record<string, string>;
  read_at: string | null;
  created_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function notificationMeta(n: Notification): { icon: string; text: string; href: string } {
  const { type, payload } = n;

  if (type === 'session:live') {
    return {
      icon: '🔴',
      text: `${payload.org_name ?? 'A channel'} is live: ${payload.session_title ?? 'New session'}`,
      href: payload.session_slug ? `/s/${payload.session_slug}` : '/discover',
    };
  }

  if (type === 'question:replied') {
    return {
      icon: '💬',
      text: `Your question got a reply in ${payload.session_title ?? 'a session'}`,
      href: payload.session_slug ? `/s/${payload.session_slug}` : '/discover',
    };
  }

  return { icon: '🔔', text: 'New notification', href: '/discover' };
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs  < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Component ────────────────────────────────────────────────────────────────

const POLL_INTERVAL = 90_000; // 90 seconds

export default function NotificationBell() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount]     = useState(0);
  const [open, setOpen]                   = useState(false);
  const [loading, setLoading]             = useState(false);
  const panelRef  = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval>>();

  const fetchNotifications = useCallback(async () => {
    try {
      const data = await api.get<{ notifications: Notification[]; unread_count: number }>(
        '/notifications?limit=30',
      );
      setNotifications(data.notifications);
      setUnreadCount(data.unread_count);
    } catch {
      // Silently ignore — user may have logged out
    }
  }, []);

  // Initial fetch + polling
  useEffect(() => {
    fetchNotifications();
    pollTimer.current = setInterval(fetchNotifications, POLL_INTERVAL);

    // Also re-fetch when the tab becomes visible again
    function onVisible() {
      if (document.visibilityState === 'visible') fetchNotifications();
    }
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(pollTimer.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchNotifications]);

  // Close panel on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  async function handleOpen() {
    setOpen(v => !v);
    if (!open) {
      setLoading(true);
      await fetchNotifications();
      setLoading(false);
    }
  }

  async function handleClickNotification(n: Notification) {
    const { href } = notificationMeta(n);
    setOpen(false);

    // Mark as read (optimistic)
    if (!n.read_at) {
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x));
      setUnreadCount(c => Math.max(0, c - 1));
      api.patch(`/notifications/${n.id}/read`, {}).catch(() => {});
    }

    router.push(href);
  }

  async function markAllRead() {
    setNotifications(prev => prev.map(n => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    setUnreadCount(0);
    try {
      await api.patch('/notifications/read', {});
    } catch {
      fetchNotifications(); // Re-sync on error
    }
  }

  return (
    <div className="relative">
      {/* Bell button */}
      <button
        ref={buttonRef}
        onClick={handleOpen}
        title="Notifications"
        className={`relative transition-colors w-11 h-11 flex items-center justify-center ${
          open ? 'text-brand-amber' : 'text-purple-200/70 hover:text-white'
        }`}
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full
                           bg-brand-orange text-white text-[10px] font-bold flex items-center justify-center leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 top-full mt-2 w-80 bg-brand-card border border-brand-border rounded-2xl shadow-2xl overflow-hidden z-50"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-brand-border/50">
            <span className="text-sm font-bold text-white">Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-purple-200/70 hover:text-brand-orange transition-colors"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-80 overflow-y-auto divide-y divide-brand-border/20">
            {loading ? (
              <div className="space-y-2 p-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-12 bg-brand-bg/60 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : notifications.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-2xl mb-2">🔔</p>
                <p className="text-sm text-purple-200/70">No notifications yet.</p>
                <p className="text-xs text-purple-200/55 mt-1">
                  Follow channels to get notified when they go live.
                </p>
              </div>
            ) : (
              notifications.map(n => {
                const { icon, text } = notificationMeta(n);
                const isUnread = !n.read_at;
                return (
                  <button
                    key={n.id}
                    onClick={() => handleClickNotification(n)}
                    className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors hover:bg-brand-bg/50 ${
                      isUnread ? 'bg-brand-purple/10' : ''
                    }`}
                  >
                    <span className="text-base flex-shrink-0 mt-0.5">{icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs leading-snug ${isUnread ? 'text-white font-medium' : 'text-purple-200/85'}`}>
                        {text}
                      </p>
                      <p className="text-[10px] text-purple-200/60 mt-1">{timeAgo(n.created_at)}</p>
                    </div>
                    {isUnread && (
                      <span className="w-1.5 h-1.5 rounded-full bg-brand-orange flex-shrink-0 mt-1.5" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Icon ─────────────────────────────────────────────────────────────────────

function BellIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
