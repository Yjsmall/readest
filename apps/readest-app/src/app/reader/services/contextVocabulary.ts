import type { EnvConfigType } from '@/services/environment';
import type { BookNote } from '@/types/book';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useContextVocabularyStore, type VocabularyTask } from '@/store/contextVocabularyStore';
import {
  getVocabularyOptions,
  hasVocabularyOutput,
  readVocabulary,
  vocabularyId,
  type VocabularyCapture,
} from '@/utils/contextVocabulary';
import { nextBooknoteStamp } from '@/utils/booknoteStamp';
import {
  isVocabularyAIConfigured,
  translateVocabulary,
  type VocabularyTranslation,
} from '@/services/ai/contextTranslation';

const writes = new Map<string, Promise<void>>();
const requests = new Map<string, AbortController>();
const getNote = (bookKey: string, id: string) =>
  useBookDataStore
    .getState()
    .getConfig(bookKey)
    ?.booknotes?.find((n) => n.id === id && n.type === 'context' && !n.deletedAt);
const setTask = (id: string, task?: VocabularyTask) =>
  useContextVocabularyStore.getState().setTask(id, task);

// Read the latest config inside the queue so overlapping card writes retain one another.
const persist = async (env: EnvConfigType, bookKey: string, id: string): Promise<boolean> => {
  setTask(id, 'saving');
  const key = bookKey.split('-')[0]!;
  const snapshot = useBookDataStore.getState().getConfig(bookKey);
  const pending = (writes.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const store = useBookDataStore.getState();
      const config = store.getConfig(bookKey) ?? snapshot;
      if (!config) throw new Error('Book is no longer open');
      await store.saveConfig(env, bookKey, config, useSettingsStore.getState().settings);
    });
  writes.set(key, pending);
  try {
    await pending;
    setTask(id);
    return true;
  } catch {
    setTask(id, 'save-error');
    return false;
  } finally {
    if (writes.get(key) === pending) writes.delete(key);
  }
};

const replace = (bookKey: string, note: BookNote) => {
  const store = useBookDataStore.getState();
  const notes = store.getConfig(bookKey)?.booknotes;
  if (!notes) return;
  store.updateBooknotes(
    bookKey,
    notes.map((n) => (n.id === note.id && n.type === 'context' ? note : n)),
  );
};

export const retryVocabulary = async (env: EnvConfigType, bookKey: string, id: string) => {
  if (requests.has(id)) return;
  const preferences = useSettingsStore.getState().settings.contextVocabulary;
  const options = getVocabularyOptions(preferences);
  let original = getNote(bookKey, id);
  if (!original) return;
  if (useContextVocabularyStore.getState().tasks[id] === 'save-error') {
    if (!(await persist(env, bookKey, id))) return;
    original = getNote(bookKey, id);
    if (!original) return;
    const saved = readVocabulary(original);
    if (saved && hasVocabularyOutput(saved, options)) return;
  }
  const content = readVocabulary(original);
  if (!content) return;
  const settings = useSettingsStore.getState().settings.aiSettings;
  if (!Object.values(options).some(Boolean) || !isVocabularyAIConfigured(settings)) {
    setTask(id);
    return;
  }
  const controller = new AbortController();
  requests.set(id, controller);
  const timeout = setTimeout(() => controller.abort(), 60_000);
  setTask(id, 'translating');
  const unchanged = () => {
    const latest = getNote(bookKey, id);
    return (
      requests.get(id) === controller &&
      latest?.updatedAt === original.updatedAt &&
      latest.note === original.note
    );
  };
  try {
    const translation = await translateVocabulary(
      settings!,
      content,
      original.text!,
      controller.signal,
      options,
      preferences?.prompts,
    );
    if (!unchanged()) return;
    clearTimeout(timeout);
    requests.delete(id);
    replace(bookKey, {
      ...original,
      note: JSON.stringify({ ...content, ...translation }),
      updatedAt: nextBooknoteStamp(original),
    });
    await persist(env, bookKey, id);
  } catch {
    if (unchanged()) setTask(id, 'translation-error');
  } finally {
    clearTimeout(timeout);
    if (requests.get(id) === controller) {
      requests.delete(id);
      if (useContextVocabularyStore.getState().tasks[id] === 'translating') setTask(id);
    }
  }
};

export const collectVocabulary = async (
  env: EnvConfigType,
  bookKey: string,
  capture: VocabularyCapture,
  cfi: string,
  sourceLang: string,
  targetLang: string,
): Promise<string> => {
  const id = vocabularyId(bookKey, cfi, capture.word, targetLang);
  const store = useBookDataStore.getState();
  const config = store.getConfig(bookKey);
  if (!config || !cfi) throw new Error('A valid book position is required');
  const previous = config.booknotes?.find((n) => n.id === id && n.type === 'context');
  if (previous && !previous.deletedAt) return id;
  const now = previous ? nextBooknoteStamp(previous) : Date.now();
  const record: BookNote = {
    id,
    type: 'context',
    cfi,
    text: capture.sentence,
    note: JSON.stringify({
      version: 1,
      word: capture.word,
      wordStart: capture.wordStart,
      wordEnd: capture.wordEnd,
      sourceLang,
      targetLang,
    }),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    deletedAt: null,
  };
  store.updateBooknotes(bookKey, [
    ...(config.booknotes ?? []).filter((n) => n.id !== id || n.type !== 'context'),
    record,
  ]);
  if (await persist(env, bookKey, id)) void retryVocabulary(env, bookKey, id);
  return id;
};

export const updateVocabulary = async (
  env: EnvConfigType,
  bookKey: string,
  id: string,
  translation: VocabularyTranslation | null,
): Promise<boolean> => {
  const original = getNote(bookKey, id);
  const content = original && readVocabulary(original);
  if (!original || !content) return false;
  requests.get(id)?.abort();
  requests.delete(id);
  const now = nextBooknoteStamp(original);
  const updated = translation
    ? { ...original, note: JSON.stringify({ ...content, ...translation }), updatedAt: now }
    : { ...original, deletedAt: now, updatedAt: now };
  replace(bookKey, updated);
  const saved = await persist(env, bookKey, id);
  if (!saved && !translation) replace(bookKey, original);
  return saved;
};
