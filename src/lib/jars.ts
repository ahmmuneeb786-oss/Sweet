import { supabase } from './supabase';

/*
  Bedtime Jars (table notification_jars). During a jar's hours the push
  server holds messages instead of buzzing, counts them, and sends one
  wake-up push when the jar ends. This file is the app side: list / save /
  delete, plus the same "is it quiet right now?" rule the database uses.
*/

export type JarKind = 'night' | 'work' | 'study' | 'me' | 'custom';

export interface Jar {
  id: string;
  name: string;
  kind: JarKind;
  start_time: string; // "22:00:00"
  end_time: string;
  days: number[]; // ISO weekdays the jar STARTS on, 1 = Monday … 7 = Sunday
  break_through: string[];
  enabled: boolean;
}

export type JarDraft = Omit<Jar, 'id'> & { id?: string };

export const MAX_JARS = 3;

export const JAR_KINDS: { id: JarKind; emoji: string; label: string; sample: string }[] = [
  { id: 'night', emoji: '🌙', label: 'Night', sample: 'Sleepy jar' },
  { id: 'work', emoji: '💼', label: 'Work', sample: 'Work jar' },
  { id: 'study', emoji: '📚', label: 'Study', sample: 'Study jar' },
  { id: 'me', emoji: '🧘', label: 'Me-time', sample: 'Me-time jar' },
  { id: 'custom', emoji: '✨', label: 'Custom', sample: 'My jar' },
];

export const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function kindInfo(kind: JarKind) {
  return JAR_KINDS.find((k) => k.id === kind) ?? JAR_KINDS[4];
}

/** "Work stuff" → work, "sleep" → night … null when nothing fits. */
export function suggestKind(name: string): JarKind | null {
  const n = name.toLowerCase();
  if (/(sleep|night|bed|dream|nap|snooze)/.test(n)) return 'night';
  if (/(work|office|job|shift|meeting)/.test(n)) return 'work';
  if (/(study|school|class|exam|uni|college|read|homework)/.test(n)) return 'study';
  if (/(me[- ]?time|relax|gym|yoga|pray|namaz|family|focus|break)/.test(n)) return 'me';
  return null;
}

export function hm(t: string): string {
  return t.slice(0, 5);
}

function minutes(t: string): number {
  const [h, m] = t.split(':').map((x) => parseInt(x, 10));
  return (h || 0) * 60 + (m || 0);
}

/** "22:00 → 07:30 · every day" */
export function describeJar(j: Pick<Jar, 'start_time' | 'end_time' | 'days'>): string {
  const days = [...j.days].sort();
  const dayText =
    days.length === 7 ? 'every day'
    : days.join(',') === '1,2,3,4,5' ? 'weekdays'
    : days.join(',') === '6,7' ? 'weekends'
    : days.map((d) => DAY_LABELS[d - 1]).join(', ');
  const overnight = minutes(j.end_time) <= minutes(j.start_time);
  return `${hm(j.start_time)} → ${hm(j.end_time)}${overnight ? ' (next day)' : ''} · ${dayText}`;
}

/** Same rule as public.jar_is_active(), on this device's clock. */
export function jarIsActive(j: Pick<Jar, 'start_time' | 'end_time' | 'days' | 'enabled'>, at = new Date()): boolean {
  if (!j.enabled) return false;
  const t = at.getHours() * 60 + at.getMinutes();
  const d = at.getDay() === 0 ? 7 : at.getDay();
  const prev = d === 1 ? 7 : d - 1;
  const s = minutes(j.start_time);
  const e = minutes(j.end_time);
  if (s < e) return j.days.includes(d) && t >= s && t < e;
  return (j.days.includes(d) && t >= s) || (j.days.includes(prev) && t < e);
}

export async function listJars(userId: string): Promise<Jar[]> {
  const { data, error } = await supabase
    .from('notification_jars')
    .select('id, name, kind, start_time, end_time, days, break_through, enabled')
    .eq('user_id', userId)
    .order('created_at');
  if (error) throw error;
  return (data ?? []) as Jar[];
}

/** Messages waiting in each jar right now: { jarId: count }. */
export async function jarCounts(): Promise<Record<string, number>> {
  const { data, error } = await supabase.from('notification_jar_items').select('jar_id, count');
  if (error) throw error;
  const out: Record<string, number> = {};
  for (const r of data ?? []) out[r.jar_id] = (out[r.jar_id] ?? 0) + r.count;
  return out;
}

export async function saveJar(userId: string, draft: JarDraft): Promise<Jar> {
  const row = {
    name: draft.name.trim().slice(0, 30),
    kind: draft.kind,
    start_time: draft.start_time,
    end_time: draft.end_time,
    days: [...new Set(draft.days)].sort(),
    break_through: draft.break_through.slice(0, 20),
    enabled: draft.enabled,
  };
  const query = draft.id
    ? supabase.from('notification_jars').update(row).eq('id', draft.id).eq('user_id', userId)
    : supabase.from('notification_jars').insert({ ...row, user_id: userId });
  const { data, error } = await query.select('id, name, kind, start_time, end_time, days, break_through, enabled').single();
  if (error) throw error;
  return data as Jar;
}

export async function deleteJar(userId: string, id: string): Promise<void> {
  const { error } = await supabase.from('notification_jars').delete().eq('id', id).eq('user_id', userId);
  if (error) throw error;
}

/** Human message for a failed save (the database's own checks). */
export function jarErrorMessage(err: unknown): string {
  const msg = (err as { message?: string })?.message ?? '';
  if (msg.includes('limit of 3')) return 'You can have up to 3 jars.';
  if (msg.includes('notification_jars_span')) return 'Start and end time can’t be the same.';
  if (msg.includes('notification_jars_days')) return 'Pick at least one day.';
  if (!navigator.onLine) return 'You’re offline — jars need a connection to save.';
  return 'Could not save the jar — please try again.';
}
