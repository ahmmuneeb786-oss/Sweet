import { localDB } from '../../db';

export interface Person { id: string; name: string }

/**
 * People you chat with, for the Heartbeat and break-through pickers. From
 * the local chat cache only (instant, offline). Locked (vault) chats are left
 * out on purpose: picking someone here would reveal them outside the vault.
 */
export async function loadPeople(): Promise<Person[]> {
  try {
    const chats = await localDB.chats.toArray();
    const seen = new Map<string, Person>();
    for (const c of chats) {
      if (c.type !== 'direct' || c.is_locked || !c.other_user_id || !c.other_user_name) continue;
      if (!seen.has(c.other_user_id)) seen.set(c.other_user_id, { id: c.other_user_id, name: c.other_user_name });
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export function nameOf(people: Person[], id: string): string {
  return people.find((p) => p.id === id)?.name ?? 'Someone';
}
