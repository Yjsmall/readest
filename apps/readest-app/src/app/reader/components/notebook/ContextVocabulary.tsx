import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PiBookmarks, PiDotsThree } from 'react-icons/pi';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { useContextVocabularyStore, type VocabularyTask } from '@/store/contextVocabularyStore';
import { useSettingsStore } from '@/store/settingsStore';
import {
  isVocabularyAIConfigured,
  type VocabularyTranslation,
} from '@/services/ai/contextTranslation';
import {
  getVocabularyOptions,
  hasVocabularyOutput,
  VOCABULARY_FIELDS,
  readVocabulary,
  type VocabularyContent,
} from '@/utils/contextVocabulary';
import VocabularySettings from './VocabularySettings';
import type { BookNote } from '@/types/book';
import type { VocabularyOptions } from '@/types/settings';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/primitives/dropdown-menu';
import { retryVocabulary, updateVocabulary } from '../../services/contextVocabulary';

const EMPTY_NOTES: BookNote[] = [];
const actionClass =
  'min-h-11 min-w-11 cursor-pointer rounded-md px-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2';

const VocabularyCard: React.FC<{
  bookKey: string;
  note: BookNote;
  content: VocabularyContent;
  task?: VocabularyTask;
  options: VocabularyOptions;
  configured: boolean;
}> = ({ bookKey, note, content, task, options, configured }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<VocabularyTranslation>({});
  const fields = VOCABULARY_FIELDS.filter(({ key }) => options[key]);
  const busy = task === 'translating' || task === 'saving';
  const translated = hasVocabularyOutput(content, options);
  const save = async () => {
    const changes = Object.fromEntries(fields.map(({ key }) => [key, draft[key]?.trim() ?? '']));
    if (await updateVocabulary(envConfig, bookKey, note.id, changes)) setEditing(false);
  };

  return (
    <article
      className='eink-bordered border-base-200 bg-base-100 select-text rounded-lg border p-4'
      aria-label={content.word}
      data-vocabulary-id={note.id}
    >
      <div className='flex items-start gap-2'>
        <h3 dir='auto' className='min-w-0 flex-1 break-words text-lg font-semibold'>
          {content.word}
        </h3>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type='button'
              className='btn btn-ghost btn-circle -me-2 -mt-2 h-11 min-h-11 w-11 shrink-0 focus-visible:outline-2'
              aria-label={_('Vocabulary actions')}
            >
              <PiDotsThree size={22} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align='end'
            className='eink-bordered border-base-200 bg-base-100 text-base-content rounded-lg border'
          >
            <DropdownMenuItem
              className='min-h-11'
              disabled={!fields.length}
              onSelect={() => {
                setDraft(Object.fromEntries(fields.map(({ key }) => [key, content[key] ?? ''])));
                setEditing(true);
              }}
            >
              {_('Edit content')}
            </DropdownMenuItem>
            <DropdownMenuItem
              className='min-h-11'
              disabled={busy || !configured || editing || !fields.length}
              onSelect={() => void retryVocabulary(envConfig, bookKey, note.id)}
            >
              {_('Regenerate')}
            </DropdownMenuItem>
            <DropdownMenuItem
              className='text-error min-h-11'
              disabled={task === 'saving'}
              onSelect={() => void updateVocabulary(envConfig, bookKey, note.id, null)}
            >
              {_('Delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {editing ? (
        <form
          className='mt-2 flex flex-col gap-3'
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <p dir='auto' className='whitespace-pre-wrap break-words text-sm leading-relaxed'>
            {note.text}
          </p>
          {fields.map(({ key, label }) => (
            <label key={key} className='flex flex-col gap-1 text-sm'>
              {_(label)}
              <textarea
                dir='auto'
                className='textarea eink-bordered border-base-200 bg-base-100 min-h-24 w-full select-text rounded-lg border'
                value={draft[key] ?? ''}
                onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
                required
              />
            </label>
          ))}
          <div className='flex justify-end gap-2'>
            <button
              type='button'
              className={`eink-bordered ${actionClass}`}
              onClick={() => setEditing(false)}
            >
              {_('Cancel')}
            </button>
            <button
              type='submit'
              className='btn btn-contrast min-h-11'
              disabled={
                task === 'saving' || !fields.length || fields.some(({ key }) => !draft[key]?.trim())
              }
            >
              {_('Save')}
            </button>
          </div>
        </form>
      ) : (
        <>
          {options.wordTranslation && content.wordTranslation && (
            <p dir='auto' className='mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed'>
              {content.wordTranslation}
            </p>
          )}
          <p dir='auto' className='mt-4 whitespace-pre-wrap break-words text-sm leading-relaxed'>
            {note.text!.slice(0, content.wordStart)}
            <strong className='bg-base-200 rounded-sm px-0.5 font-semibold'>
              {note.text!.slice(content.wordStart, content.wordEnd)}
            </strong>
            {note.text!.slice(content.wordEnd)}
          </p>
          {options.sentenceTranslation && content.sentenceTranslation && (
            <p
              dir='auto'
              className='text-base-content/70 mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed'
            >
              {content.sentenceTranslation}
            </p>
          )}
          {fields
            .filter(
              ({ key }) =>
                (key === 'grammarAnalysis' || key === 'vocabularyAnalysis') && content[key],
            )
            .map(({ key, label }) => (
              <section key={key} className='border-base-200 mt-4 border-t pt-3'>
                <h4 className='text-sm font-medium'>{_(label)}</h4>
                <p
                  dir='auto'
                  className='text-base-content/70 mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed'
                >
                  {content[key]}
                </p>
              </section>
            ))}
        </>
      )}
      <div aria-live='polite' role='status'>
        {task === 'translating' && (
          <p className='text-base-content/70 mt-3 text-sm'>{_('Generating…')}</p>
        )}
        {(task === 'translation-error' || task === 'save-error') && (
          <div className='mt-2 flex items-center justify-between gap-2 text-sm'>
            <span className='text-error'>
              {task === 'save-error' ? _("Couldn't save") : _('Generation failed')}
            </span>
            <button
              type='button'
              className={actionClass}
              onClick={() => void retryVocabulary(envConfig, bookKey, note.id)}
            >
              {_('Retry')}
            </button>
          </div>
        )}
      </div>
      {!editing &&
        !busy &&
        !translated &&
        task !== 'translation-error' &&
        task !== 'save-error' &&
        configured && (
          <button
            type='button'
            className={`${actionClass} mt-2`}
            onClick={() => void retryVocabulary(envConfig, bookKey, note.id)}
          >
            {_('Generate')}
          </button>
        )}
    </article>
  );
};

const ContextVocabulary: React.FC<{ bookKey: string }> = ({ bookKey }) => {
  const _ = useTranslation();
  const notes = useBookDataStore(
    (s) => s.booksData[bookKey.split('-')[0]!]?.config?.booknotes ?? EMPTY_NOTES,
  );
  const { tasks, selectedId } = useContextVocabularyStore();
  const { settings, setSettingsDialogBookKey, setRequestedPanel, setSettingsDialogOpen } =
    useSettingsStore();
  const [activeTab, setActiveTab] = useState<'cards' | 'configuration'>('cards');
  const listRef = useRef<HTMLUListElement>(null);
  const configured = isVocabularyAIConfigured(settings.aiSettings);
  const options = getVocabularyOptions(settings.contextVocabulary);
  const hasEnabledFields = Object.values(options).some(Boolean);
  const cards = useMemo(
    () =>
      notes
        .filter((note) => note.type === 'context' && !note.deletedAt)
        .map((note) => ({ note, content: readVocabulary(note) }))
        .sort((a, b) => b.note.createdAt - a.note.createdAt),
    [notes],
  );
  const previewCard = cards.find(({ note }) => note.id === selectedId) ?? cards[0];
  useEffect(() => {
    setActiveTab('cards');
  }, [selectedId, bookKey]);
  useEffect(() => {
    const selected = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>('[data-vocabulary-id]') ?? [],
    ).find((el) => el.dataset['vocabularyId'] === selectedId);
    selected?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedId, cards.length, activeTab]);

  return (
    <section className='flex min-h-0 flex-1 flex-col gap-3 px-3 pb-3' aria-label={_('Vocabulary')}>
      <h2 className='text-lg font-semibold tracking-tight'>{_('Vocabulary')}</h2>
      <div
        role='tablist'
        aria-label={_('Vocabulary views')}
        className='border-base-200 flex shrink-0 gap-1 border-b pb-2'
      >
        {(['cards', 'configuration'] as const).map((tab) => (
          <button
            key={tab}
            type='button'
            role='tab'
            id={`vocabulary-${tab}-tab`}
            aria-selected={activeTab === tab}
            aria-controls={`vocabulary-${tab}`}
            tabIndex={activeTab === tab ? 0 : -1}
            className={`min-h-11 flex-1 cursor-pointer rounded-lg px-3 text-sm focus-visible:outline-2 ${activeTab === tab ? 'bg-base-300/85 font-medium' : 'hover:bg-base-200'}`}
            onClick={() => setActiveTab(tab)}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const next =
                event.key === 'Home'
                  ? 'cards'
                  : event.key === 'End'
                    ? 'configuration'
                    : tab === 'cards'
                      ? 'configuration'
                      : 'cards';
              setActiveTab(next);
              document.getElementById(`vocabulary-${next}-tab`)?.focus();
            }}
          >
            {tab === 'cards' ? _('Cards') : _('Configuration')}
          </button>
        ))}
      </div>
      {activeTab === 'configuration' ? (
        <VocabularySettings
          bookKey={bookKey}
          word={previewCard?.content?.word}
          context={previewCard?.note.text}
        />
      ) : (
        <>
          {!configured && hasEnabledFields && cards.length > 0 && (
            <div className='eink-bordered border-base-200 bg-base-100 rounded-lg border p-3 text-sm'>
              <p>{_('Configure AI to generate card content')}</p>
              <button
                type='button'
                className={`${actionClass} mt-1`}
                onClick={() => {
                  setSettingsDialogBookKey(bookKey);
                  setRequestedPanel('AI');
                  setSettingsDialogOpen(true);
                }}
              >
                {_('AI Settings')}
              </button>
            </div>
          )}
          <div
            role='tabpanel'
            id='vocabulary-cards'
            aria-labelledby='vocabulary-cards-tab'
            className='min-h-0 flex-1 overflow-y-auto pb-2'
          >
            <ul ref={listRef} className='space-y-3'>
              {cards.map(({ note, content }) => (
                <li key={note.id}>
                  {content ? (
                    <VocabularyCard
                      bookKey={bookKey}
                      note={note}
                      content={content}
                      task={tasks[note.id]}
                      options={options}
                      configured={configured}
                    />
                  ) : (
                    <article className='eink-bordered border-base-200 bg-base-100 rounded-lg border p-4'>
                      <p dir='auto' className='select-text break-words'>
                        {note.text}
                      </p>
                      <p className='text-error mt-2 text-sm'>
                        {_('This vocabulary record could not be read')}
                      </p>
                    </article>
                  )}
                </li>
              ))}
              {cards.length === 0 && (
                <li className='text-base-content/70 flex flex-col items-center gap-3 px-3 py-10 text-center text-sm'>
                  <PiBookmarks size={28} aria-hidden='true' />
                  <p>{_('No vocabulary yet')}</p>
                  <p>{_('Select a word in your book and choose Vocabulary to collect it')}</p>
                </li>
              )}
            </ul>
          </div>
        </>
      )}
    </section>
  );
};

export default ContextVocabulary;
