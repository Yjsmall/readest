import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import type { VocabularyTranslation } from '@/services/ai/contextTranslation';
import type { ContextVocabularySettings } from '@/types/settings';
import type { BookConfig, BookNote } from '@/types/book';
import type { EnvConfigType } from '@/services/environment';
import { useContextVocabularyStore } from '@/store/contextVocabularyStore';
import { readVocabulary } from '@/utils/contextVocabulary';
import {
  collectVocabulary,
  retryVocabulary,
  updateVocabulary,
} from '@/app/reader/services/contextVocabulary';

const h = vi.hoisted(() => ({
  configs: {} as Record<string, { booknotes: BookNote[] }>,
  configured: true,
  options: {} as Partial<ContextVocabularySettings>,
  save: vi.fn(async () => {}),
  translate: vi.fn<(...args: unknown[]) => Promise<VocabularyTranslation>>(async () => ({
    wordTranslation: '微妙的',
    sentenceTranslation: '一个微妙的变化。',
  })),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: {
    getState: () => ({
      getConfig: (key: string) => h.configs[key],
      updateBooknotes: (key: string, notes: BookNote[]) => {
        h.configs[key] = { booknotes: notes };
        return h.configs[key];
      },
      saveConfig: (_env: unknown, _key: string, _config: BookConfig) => h.save(),
    }),
  },
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ settings: { aiSettings: { enabled: true }, contextVocabulary: h.options } }),
  },
}));
vi.mock('@/services/ai/contextTranslation', () => ({
  isVocabularyAIConfigured: () => h.configured,
  translateVocabulary: (...args: unknown[]) => h.translate(...(args as [])),
}));

const env = {} as EnvConfigType;
const capture = { word: 'subtle', sentence: 'A subtle change.', wordStart: 2, wordEnd: 8 };
const collect = (key = 'book-1', cfi = 'epubcfi(/6/2!/4/2/1:2)') =>
  collectVocabulary(env, key, capture, cfi, 'en', 'zh-CN');
const note = (id: string, key = 'book-1') => h.configs[key]!.booknotes.find((n) => n.id === id)!;
const deferredTranslation = () => {
  let resolve!: (value: { wordTranslation: string; sentenceTranslation: string }) => void;
  const promise = new Promise<{ wordTranslation: string; sentenceTranslation: string }>((done) => {
    resolve = done;
  });
  h.translate.mockReturnValueOnce(promise);
  return resolve;
};

beforeEach(() => {
  vi.clearAllMocks();
  h.save.mockResolvedValue(undefined);
  h.translate.mockResolvedValue({
    wordTranslation: '微妙的',
    sentenceTranslation: '一个微妙的变化。',
  });
  h.configured = true;
  h.options = {};
  h.configs = { 'book-1': { booknotes: [] }, 'other-1': { booknotes: [] } };
  useContextVocabularyStore.setState({ selectedId: null, tasks: {} });
});

describe('vocabulary persistence and AI tasks', () => {
  it('saves original text before requesting AI and persists both translations', async () => {
    const resolve = deferredTranslation();
    const id = await collect();
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.translate).toHaveBeenCalledTimes(1);
    expect(note(id).text).toBe(capture.sentence);
    expect(readVocabulary(note(id))?.word).toBe('subtle');
    resolve({ wordTranslation: '微妙的', sentenceTranslation: '一个微妙的变化。' });
    await waitFor(() => expect(h.save).toHaveBeenCalledTimes(2));
    expect(readVocabulary(note(id))?.sentenceTranslation).toBe('一个微妙的变化。');
  });

  it('deduplicates repeated clicks without another AI request', async () => {
    const resolve = deferredTranslation();
    const [a, b] = await Promise.all([collect(), collect()]);
    expect(a).toBe(b);
    expect(h.configs['book-1']!.booknotes).toHaveLength(1);
    expect(h.translate).toHaveBeenCalledTimes(1);
    resolve({ wordTranslation: 'x', sentenceTranslation: 'y' });
    await waitFor(() => expect(useContextVocabularyStore.getState().tasks[a]).toBeUndefined());
  });

  it('keeps untranslated originals without AI configuration', async () => {
    h.configured = false;
    const id = await collect();
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.translate).not.toHaveBeenCalled();
    expect(useContextVocabularyStore.getState().tasks[id]).toBeUndefined();
    expect(note(id).text).toBe(capture.sentence);
  });

  it('saves only the original text when every output is disabled', async () => {
    h.options = {
      wordTranslation: false,
      sentenceTranslation: false,
      grammarAnalysis: false,
      vocabularyAnalysis: false,
    };
    const id = await collect();
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.translate).not.toHaveBeenCalled();
    expect(note(id).text).toBe(capture.sentence);
    expect(useContextVocabularyStore.getState().tasks[id]).toBeUndefined();
  });

  it('passes selected analysis options to AI and persists their results', async () => {
    h.options = {
      wordTranslation: false,
      sentenceTranslation: false,
      grammarAnalysis: true,
      vocabularyAnalysis: true,
    };
    h.translate.mockResolvedValueOnce({
      grammarAnalysis: '语法说明',
      vocabularyAnalysis: '词汇说明',
    });
    const id = await collect();
    await waitFor(() => expect(useContextVocabularyStore.getState().tasks[id]).toBeUndefined());
    expect(h.translate).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      capture.sentence,
      expect.anything(),
      h.options,
      h.options.prompts,
    );
    expect(readVocabulary(note(id))).toMatchObject({
      grammarAnalysis: '语法说明',
      vocabularyAnalysis: '词汇说明',
    });
    expect(readVocabulary(note(id))?.wordTranslation).toBeUndefined();
  });

  it('forwards saved per-section prompt templates when generating a card', async () => {
    h.options = { prompts: { wordTranslation: '解释 {word} 在 {ctx} 中的意思' } };
    const id = await collect();
    await waitFor(() => expect(useContextVocabularyStore.getState().tasks[id]).toBeUndefined());
    expect(h.translate).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      capture.sentence,
      expect.anything(),
      expect.anything(),
      h.options.prompts,
    );
  });

  it('retains the card on a failed local save and retries it before translating', async () => {
    h.save.mockRejectedValueOnce(new Error('disk full'));
    h.configured = false;
    const id = await collect();
    expect(useContextVocabularyStore.getState().tasks[id]).toBe('save-error');
    expect(h.translate).not.toHaveBeenCalled();
    await retryVocabulary(env, 'book-1', id);
    expect(h.save).toHaveBeenCalledTimes(2);
    expect(note(id).text).toBe(capture.sentence);
    expect(useContextVocabularyStore.getState().tasks[id]).toBeUndefined();
  });

  it('writes the result to the captured book and retains intervening annotations', async () => {
    const resolve = deferredTranslation();
    const id = await collect();
    h.configs['book-1']!.booknotes.push({
      id: 'highlight',
      type: 'annotation',
      cfi: 'epubcfi(/6/2)',
      note: '',
      createdAt: 1,
      updatedAt: 1,
    });
    h.configured = false;
    await collect('other-1');
    resolve({ wordTranslation: '微妙的', sentenceTranslation: '一个微妙的变化。' });
    await waitFor(() => expect(readVocabulary(note(id))?.wordTranslation).toBe('微妙的'));
    expect(h.configs['book-1']!.booknotes.some((n) => n.id === 'highlight')).toBe(true);
    expect(readVocabulary(h.configs['other-1']!.booknotes[0]!)?.wordTranslation).toBeUndefined();
  });

  it('does not overwrite user edits or revive deleted cards after a late AI response', async () => {
    const resolve = deferredTranslation();
    const id = await collect();
    await updateVocabulary(env, 'book-1', id, {
      wordTranslation: '用户词义',
      sentenceTranslation: '用户句译',
    });
    resolve({ wordTranslation: 'stale', sentenceTranslation: 'stale' });
    await waitFor(() => expect(readVocabulary(note(id))?.wordTranslation).toBe('用户词义'));
    const resolveAgain = deferredTranslation();
    const pending = retryVocabulary(env, 'book-1', id);
    await updateVocabulary(env, 'book-1', id, null);
    resolveAgain({ wordTranslation: 'stale', sentenceTranslation: 'stale' });
    await pending;
    expect(note(id).deletedAt).toBeTruthy();
  });

  it('retains existing translations when retranslation fails', async () => {
    const id = await collect();
    await waitFor(() => expect(useContextVocabularyStore.getState().tasks[id]).toBeUndefined());
    h.translate.mockRejectedValueOnce(new Error('offline'));
    await retryVocabulary(env, 'book-1', id);
    expect(readVocabulary(note(id))?.wordTranslation).toBe('微妙的');
    expect(useContextVocabularyStore.getState().tasks[id]).toBe('translation-error');
  });
});
