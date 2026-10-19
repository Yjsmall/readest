import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import ContextVocabulary from '@/app/reader/components/notebook/ContextVocabulary';
import NotebookTabNavigation from '@/app/reader/components/notebook/NotebookTabNavigation';
import type { BookNote } from '@/types/book';
import '@/styles/globals.css';

const h = vi.hoisted(() => ({ notes: [] as BookNote[] }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {}, appService: {} }) }));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) =>
    (
      ({
        Vocabulary: '语境',
        Notes: '笔记',
      }) as Record<string, string>
    )[key] ?? key,
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: (selector: (s: unknown) => unknown) =>
    selector({ booksData: { book: { config: { booknotes: h.notes } } } }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: (selector?: (s: unknown) => unknown) => {
    const state = { settings: { aiSettings: { enabled: true } } };
    return selector ? selector(state) : state;
  },
}));
vi.mock('@/services/ai/contextTranslation', () => ({ isVocabularyAIConfigured: () => true }));
vi.mock('@/app/reader/services/contextVocabulary', () => ({
  retryVocabulary: vi.fn(),
  updateVocabulary: vi.fn(),
}));

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-eink');
  document.documentElement.removeAttribute('dir');
});

describe('context vocabulary layout', () => {
  it.each([
    { name: 'phone', width: 390, theme: 'default-light', eink: false, rtl: false },
    { name: 'narrow-dark-panel', width: 280, theme: 'default-dark', eink: false, rtl: false },
    { name: 'eink', width: 390, theme: 'default-light', eink: true, rtl: false },
    { name: 'rtl', width: 390, theme: 'default-light', eink: false, rtl: true },
  ])('keeps complete cards readable in $name', async ({ width, theme, eink, rtl }) => {
    await page.viewport(width, 844);
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-eink', String(eink));
    document.documentElement.setAttribute('dir', rtl ? 'rtl' : 'ltr');
    h.notes = [
      {
        id: 'context-1',
        word: 'resilient',
        sentence: 'She remained resilient in the face of adversity.',
        start: 13,
        meaning: '有韧性的；能够恢复的',
        translation: '面对逆境，她依然坚韧。',
      },
      {
        id: 'context-2',
        word: 'subtle',
        sentence: 'A subtle change in her expression caught his attention.',
        start: 2,
        meaning: '微妙的；不易察觉的',
        translation: '她表情的细微变化引起了他的注意。',
      },
    ].map(
      ({ id, word, sentence, start, meaning, translation }): BookNote => ({
        id,
        type: 'context',
        cfi: 'epubcfi(/6/2)',
        text: sentence,
        note: JSON.stringify({
          version: 1,
          word,
          wordStart: start,
          wordEnd: start + word.length,
          sourceLang: 'en',
          targetLang: 'zh',
          wordTranslation: meaning,
          sentenceTranslation: translation,
        }),
        createdAt: 100,
        updatedAt: 100,
      }),
    );
    render(
      <div className='bg-base-200 text-base-content flex h-[844px] w-full flex-col font-sans'>
        <ContextVocabulary bookKey='book-1' />
        <NotebookTabNavigation activeTab='context' onTabChange={vi.fn()} />
      </div>,
    );
    const card = screen.getAllByRole('article')[0]!;
    const rect = card.getBoundingClientRect();
    expect(rect.width).toBeLessThan(width);
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(width);
    expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth);
    expect(getComputedStyle(card).borderTopWidth).toBe('1px');
    const menu = screen.getAllByRole('button', { name: 'Vocabulary actions' })[0]!;
    expect(menu.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
    expect(menu.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    expect(screen.getByRole('button', { name: '语境' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('searchbox')).toBeNull();
    await page.getByRole('tab', { name: 'Configuration' }).click();
    expect(screen.getByRole('checkbox', { name: 'Grammar analysis' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Vocabulary analysis' })).toBeTruthy();
    const editor = page.getByRole('textbox', { name: 'Prompt', exact: true });
    await editor.fill('解释 ');
    await page.getByRole('button', { name: 'Insert word', exact: true }).click();
    await expect.element(editor).toHaveValue('解释 {word}');
    await page.getByRole('button', { name: 'Insert sentence', exact: true }).click();
    await expect.element(editor).toHaveValue('解释 {word}{ctx}');
    const preview = screen.getByRole('region', { name: 'Prompt preview' });
    expect(preview.textContent).toBe(
      '解释 resilientShe remained resilient in the face of adversity.',
    );
    expect(preview.scrollWidth).toBeLessThanOrEqual(preview.clientWidth);
    expect(screen.getByRole('tabpanel', { name: 'Configuration' }).scrollWidth).toBeLessThanOrEqual(
      width,
    );
  });
});
