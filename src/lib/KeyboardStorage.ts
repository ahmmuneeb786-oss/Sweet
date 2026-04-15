import { openDB } from 'idb';

const DB_NAME = 'SweetKeyboardDB';
const STORE_NAME = 'KeyboardBrain';

export const saveBrainToDisk = async (brainData: any) => {
  const db = await openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    },
  });
  await db.put(STORE_NAME, brainData, 'current_brain');
  console.log("Brain saved to offline storage 💾");
};

export const loadBrainFromDisk = async () => {
  const db = await openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    },
  });
  return await db.get(STORE_NAME, 'current_brain');
};