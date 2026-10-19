import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextVocabularySettings, SystemSettings } from '@/types/settings';
import type { BookNote } from '@/types/book';
import ContextVocabulary from '@/app/reader/components/notebook/ContextVocabulary';
import { useContextVocabularyStore } from '@/store/contextVocabularyStore';

const h = vi.hoisted(() => ({
  notes: [] as BookNote[],
  options: {
    wordTranslation: true,
    sentenceTranslation: true,
    grammarAnalysis: false,
    vocabularyAnalysis: false,
  } as ContextVocabularySettings,
  saveSettings: vi.fn(async (_env: unknown, _settings: unknown) => {}),
  configured: true,
  update: vi.fn(async () => true),
  retry: vi.fn(),
  openSettings: vi.fn(),
  requestedPanel: vi.fn(),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: (selector: (s: unknown) => unknown) =>
    selector({ booksData: { book: { config: { booknotes: h.notes } } } }),
}));
vi.mock('@/store/settingsStore', () => {
  const state = () => ({
    settings: { aiSettings: {}, contextVocabulary: h.options },
    setSettings: (settings: SystemSettings) => {
      h.options = settings.contextVocabulary!;
    },
    saveSettings: h.saveSettings,
    setSettingsDialogBookKey: vi.fn(),
    setRequestedPanel: h.requestedPanel,
    setSettingsDialogOpen: h.openSettings,
  });
  const useSettingsStore = Object.assign(
    (selector?: (s: unknown) => unknown) => (selector ? selector(state()) : state()),
    { getState: state },
  );
  return { useSettingsStore };
});
vi.mock('@/services/ai/contextTranslation', () => ({
  isVocabularyAIConfigured: () => h.configured,
}));
vi.mock('@/app/reader/services/contextVocabulary', () => ({
  retryVocabulary: (...args: unknown[]) => h.retry(...args),
  updateVocabulary: (...args: unknown[]) => h.update(...(args as [])),
}));

const card = (id = 'context-1', word = 'subtle'): BookNote => ({
  id,
  type: 'context',
  cfi: 'epubcfi(/6/2)',
  text: `A ${word} change.`,
  note: JSON.stringify({
    version: 1,
    word,
    wordStart: 2,
    wordEnd: word.length + 2,
    sourceLang: 'en',
    targetLang: 'zh',
    wordTranslation: '微妙的',
    sentenceTranslation: '一个微妙的变化。',
  }),
  createdAt: 100,
  updatedAt: 100,
});
beforeEach(() => {
  vi.clearAllMocks();
  h.configured = true;
  h.options = {
    wordTranslation: true,
    sentenceTranslation: true,
    grammarAnalysis: false,
    vocabularyAnalysis: false,
  };
  h.saveSettings.mockResolvedValue(undefined);
  h.notes = [card()];
  useContextVocabularyStore.setState({ selectedId: null, tasks: {} });
});
afterEach(cleanup);

describe('vocabulary cards', () => {
  it('shows complete content as a card without saved status, chapter or source action', () => {
    h.notes.push({ ...card('deleted'), deletedAt: 200 }, { ...card('note'), type: 'annotation' });
    render(<ContextVocabulary bookKey='book-1' />);
    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(1);
    expect(within(cards[0]!).getByRole('heading', { name: 'subtle' })).toBeTruthy();
    expect(cards[0]!.textContent).toContain('A subtle change.');
    expect(cards[0]!.textContent).toContain('一个微妙的变化。');
    expect(screen.queryByText('Saved')).toBeNull();
    expect(screen.queryByText('Return to text')).toBeNull();
    expect(cards[0]!.querySelector('strong')?.textContent).toBe('subtle');
  });

  it('shows cards without the introductory text or search field', () => {
    render(<ContextVocabulary bookKey='book-1' />);
    expect(screen.queryByText('Collect words and sentences as you read')).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Configuration' })).toBeTruthy();
  });

  it('persists independent analysis switches in the configuration tab', async () => {
    render(<ContextVocabulary bookKey='book-1' />);
    fireEvent.click(screen.getByRole('tab', { name: 'Configuration' }));
    const grammar = screen.getByRole('checkbox', { name: 'Grammar analysis' }) as HTMLInputElement;
    expect(grammar.checked).toBe(false);
    fireEvent.click(grammar);
    await waitFor(() =>
      expect(h.saveSettings).toHaveBeenCalledWith(
        {},
        expect.objectContaining({
          contextVocabulary: {
            wordTranslation: true,
            sentenceTranslation: true,
            grammarAnalysis: true,
            vocabularyAnalysis: false,
          },
        }),
      ),
    );
    expect(
      (screen.getByRole('checkbox', { name: 'Grammar analysis' }) as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (screen.getByRole('checkbox', { name: 'Vocabulary analysis' }) as HTMLInputElement).checked,
    ).toBe(false);
    expect(h.retry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab', { name: 'Cards' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    expect(h.retry).toHaveBeenCalledWith({}, 'book-1', 'context-1');
  });

  it('inserts word and sentence labels into a custom prompt and saves it', async () => {
    render(<ContextVocabulary bookKey='book-1' />);
    fireEvent.click(screen.getByRole('tab', { name: 'Configuration' }));
    const editor = screen.getByRole('textbox', { name: 'Prompt' }) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'Explain  in ' } });
    editor.setSelectionRange(8, 8);
    fireEvent.click(screen.getByRole('button', { name: 'Insert word' }));
    await waitFor(() => expect(editor.value).toBe('Explain {word} in '));
    editor.setSelectionRange(editor.value.length, editor.value.length);
    fireEvent.click(screen.getByRole('button', { name: 'Insert sentence' }));
    await waitFor(() => expect(editor.value).toBe('Explain {word} in {ctx}'));
    fireEvent.click(screen.getByRole('button', { name: 'Save prompt' }));
    await waitFor(() => expect(h.options.prompts?.wordTranslation).toBe('Explain {word} in {ctx}'));
    expect(screen.getByRole('region', { name: 'Prompt preview' }).textContent).toBe(
      'Explain subtle in A subtle change.',
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Grammar analysis' }));
    await waitFor(() => expect(h.options.grammarAnalysis).toBe(true));
    expect(h.options.prompts?.wordTranslation).toBe('Explain {word} in {ctx}');
    expect(h.retry).not.toHaveBeenCalled();
  });

  it('keeps a prompt draft after a failed save so it can be retried', async () => {
    h.saveSettings.mockRejectedValueOnce(new Error('disk unavailable'));
    render(<ContextVocabulary bookKey='book-1' />);
    fireEvent.click(screen.getByRole('tab', { name: 'Configuration' }));
    const editor = screen.getByRole('textbox', { name: 'Prompt' }) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'Explain {word} in {ctx}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save prompt' }));
    await screen.findByRole('alert');
    expect(editor.value).toBe('Explain {word} in {ctx}');
    expect(h.options.prompts?.wordTranslation).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Save prompt' }));
    await waitFor(() => expect(h.options.prompts?.wordTranslation).toBe('Explain {word} in {ctx}'));
  });

  it('rolls back a switch when settings cannot be saved', async () => {
    h.saveSettings.mockRejectedValueOnce(new Error('disk unavailable'));
    render(<ContextVocabulary bookKey='book-1' />);
    fireEvent.click(screen.getByRole('tab', { name: 'Configuration' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Grammar analysis' }));
    await screen.findByRole('alert');
    expect(
      (screen.getByRole('checkbox', { name: 'Grammar analysis' }) as HTMLInputElement).checked,
    ).toBe(false);
  });

  it('shows enabled analyses and preserves disabled content in the record', () => {
    h.options.grammarAnalysis = true;
    const original = JSON.parse(h.notes[0]!.note);
    h.notes[0]!.note = JSON.stringify({
      ...original,
      grammarAnalysis: '主语加谓语结构',
      vocabularyAnalysis: '词汇用法说明',
    });
    render(<ContextVocabulary bookKey='book-1' />);
    expect(screen.getByText('主语加谓语结构')).toBeTruthy();
    expect(screen.queryByText('词汇用法说明')).toBeNull();
    expect(JSON.parse(h.notes[0]!.note).vocabularyAnalysis).toBe('词汇用法说明');
  });

  it('provides a retry on failure and keeps the original card visible', () => {
    useContextVocabularyStore.setState({ tasks: { 'context-1': 'translation-error' } });
    render(<ContextVocabulary bookKey='book-1' />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.retry).toHaveBeenCalledWith({}, 'book-1', 'context-1');
    expect(screen.getByText('微妙的')).toBeTruthy();
  });

  it('links to the existing AI settings without hiding cards when AI is disabled', () => {
    h.configured = false;
    render(<ContextVocabulary bookKey='book-1' />);
    fireEvent.click(screen.getByRole('button', { name: 'AI Settings' }));
    expect(h.requestedPanel).toHaveBeenCalledWith('AI');
    expect(h.openSettings).toHaveBeenCalledWith(true);
    expect(screen.getByRole('article')).toBeTruthy();
  });

  it('edits both translations using the card menu and saves them together', async () => {
    render(<ContextVocabulary bookKey='book-1' />);
    const trigger = screen.getByRole('button', { name: 'Vocabulary actions' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edit content' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Word meaning' }), {
      target: { value: '用户词义' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Sentence translation' }), {
      target: { value: '用户句译' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(h.update).toHaveBeenCalledWith({}, 'book-1', 'context-1', {
        wordTranslation: '用户词义',
        sentenceTranslation: '用户句译',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Word meaning' })).toBeNull());
  });
});
