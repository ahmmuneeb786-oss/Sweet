import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { localDB } from '../../db';
import { useNotify } from '../../contexts/NotificationContext';
import { muteLeftLabel, readMute, setChatMute, type MuteState } from '../../lib/chatMute';
import { isSelfChatId } from '../../lib/selfChat';
import { Loading, TabBody, TabHeader } from '../storage/parts';
import type { Tokens } from '../storage/tokens';

interface MutedRow {
  chatId: string;
  name: string;
  locked: boolean;
  mute: MuteState;
}

/** Every chat that can't buzz you right now, with time left and Unmute. */
export async function loadMutedChats(userId: string): Promise<MutedRow[]> {
  const { data, error } = await supabase
    .from('chat_participants')
    .select('chat_id, is_locked, is_muted, muted_until')
    .eq('user_id', userId)
    .eq('is_muted', true)
    .is('left_at', null);
  if (error) throw error;

  const rows = (data ?? [])
    .map((r) => ({ chatId: r.chat_id as string, locked: !!r.is_locked, mute: readMute(r.is_muted, r.muted_until) }))
    .filter((r) => r.mute.muted);
  if (rows.length === 0) return [];

  // Names from the local cache first; ask the server only for the rest.
  const cached = await localDB.chats.bulkGet(rows.map((r) => r.chatId)).catch(() => []);
  const names = new Map<string, string>();
  cached.forEach((c) => { if (c) names.set(c.id, c.other_user_name || c.name || ''); });
  const missing = rows.filter((r) => !r.locked && !names.get(r.chatId)).map((r) => r.chatId);
  if (missing.length) {
    const { data: others } = await supabase
      .from('chat_participants')
      .select('chat_id, profiles:user_id ( display_name )')
      .in('chat_id', missing)
      .neq('user_id', userId);
    for (const o of (others ?? []) as unknown as { chat_id: string; profiles: { display_name: string | null } | null }[]) {
      if (o.profiles?.display_name) names.set(o.chat_id, o.profiles.display_name);
    }
  }

  return rows
    .map((r) => ({
      ...r,
      // Never show who a locked (vault) chat is with outside the vault.
      name: r.locked ? 'Locked chat' : isSelfChatId(r.chatId) ? 'Saved Messages' : names.get(r.chatId) || 'Chat',
    }))
    .sort((a, b) => (a.mute.until?.getTime() ?? Infinity) - (b.mute.until?.getTime() ?? Infinity));
}

export function MutedChatsView({ t, userId, onBack, onChanged }: {
  t: Tokens; userId: string; onBack: () => void; onChanged: () => void;
}) {
  const { showSuccess, showError } = useNotify();
  const [rows, setRows] = useState<MutedRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setFailed(false);
    loadMutedChats(userId).then(setRows).catch(() => { setFailed(true); setRows([]); });
  }, [userId]);

  useEffect(load, [load]);

  async function unmute(row: MutedRow) {
    setBusy(row.chatId);
    try {
      await setChatMute(row.chatId, userId, null);
      setRows((prev) => (prev ?? []).filter((r) => r.chatId !== row.chatId));
      onChanged();
      showSuccess(`${row.locked ? 'Locked chat' : row.name} can reach you again 🔔`);
    } catch {
      showError('Could not unmute — check your connection and try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <TabBody t={t}>
      <TabHeader t={t} onBack={onBack} label="Muted chats" />
      {rows === null && <Loading t={t} text="Finding quiet chats…" />}
      {rows !== null && rows.length === 0 && (
        <div className={`rounded-2xl p-6 text-center ${t.intro}`}>
          <p className="text-3xl" aria-hidden="true">🔔</p>
          <p className="text-sm font-bold mt-2">{failed ? 'Could not load muted chats' : 'Nothing is muted'}</p>
          <p className={`text-[11px] mt-1 ${t.sub}`}>
            {failed ? 'Check your connection and try again.' : 'Every chat can reach you. Mute one from its ⋮ menu.'}
          </p>
          {failed && <button onClick={load} className={`mt-3 text-xs font-bold ${t.action}`}>Try again</button>}
        </div>
      )}
      {rows && rows.length > 0 && (
        <div className="space-y-2.5">
          {rows.map((r) => (
            <div key={r.chatId} className={`rounded-2xl p-4 flex items-center gap-3 ${t.card}`}>
              <div className={`w-11 h-11 shrink-0 rounded-xl flex items-center justify-center text-lg font-black ${t.iconBox}`} aria-hidden="true">
                {r.locked ? '🔒' : (r.name.trim()[0] || '?').toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-bold truncate">{r.name}</h4>
                <p className={`text-[11px] mt-0.5 ${t.sub}`}>🔕 {r.mute.until ? muteLeftLabel(r.mute) : 'Muted until you unmute'}</p>
              </div>
              <button
                onClick={() => unmute(r)}
                disabled={busy === r.chatId}
                className={`text-xs font-bold px-3 py-1.5 rounded-full disabled:opacity-50 ${t.primary}`}
              >
                {busy === r.chatId ? '…' : 'Unmute'}
              </button>
            </div>
          ))}
        </div>
      )}
    </TabBody>
  );
}
