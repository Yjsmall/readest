import React, { useRef, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { BoxedList, SettingsRow, SettingsSelect } from '@/components/settings/primitives';
import { VOCABULARY_FIELDS } from '@/utils/contextVocabulary';
import type { VocabularyField, VocabularyPrompts } from '@/types/settings';

const VocabularyPromptEditor: React.FC<{
  prompts?: VocabularyPrompts;
  word?: string;
  context?: string;
  saving: boolean;
  onSave: (field: VocabularyField, template: string) => Promise<void>;
}> = ({ prompts = {}, word = '', context = '', saving, onSave }) => {
  const _ = useTranslation();
  const [field, setField] = useState<VocabularyField>('wordTranslation');
  const [drafts, setDrafts] = useState<VocabularyPrompts>({});
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const definition = VOCABULARY_FIELDS.find((item) => item.key === field)!;
  const saved = prompts[field] ?? definition.instruction;
  const value = drafts[field] ?? saved;
  const setValue = (text: string) => setDrafts((previous) => ({ ...previous, [field]: text }));
  const insert = (token: '{word}' | '{ctx}') => {
    const editor = editorRef.current;
    if (!editor) return;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    setValue(`${value.slice(0, start)}${token}${value.slice(end)}`);
    requestAnimationFrame(() => {
      editor.focus({ preventScroll: true });
      editor.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <BoxedList title={_('Prompt')}>
      <SettingsRow label={_('Content item')}>
        <SettingsSelect
          value={field}
          ariaLabel={_('Content item')}
          disabled={saving}
          onChange={(event) => setField(event.target.value as VocabularyField)}
          options={VOCABULARY_FIELDS.map(({ key, label }) => ({ value: key, label: _(label) }))}
        />
      </SettingsRow>
      <form
        className='flex flex-col gap-3 py-3 pe-4'
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim()) void onSave(field, value);
        }}
      >
        <div className='flex flex-wrap gap-2'>
          {(
            [
              { token: '{word}', label: _('Word'), action: _('Insert word') },
              { token: '{ctx}', label: _('Original sentence'), action: _('Insert sentence') },
            ] as const
          ).map(({ token, label, action }) => (
            <button
              key={token}
              type='button'
              disabled={saving}
              aria-label={action}
              title={action}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => insert(token)}
              className='eink-bordered border-base-200 bg-base-200/60 hover:bg-base-300 inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-sm focus-visible:outline-2 disabled:cursor-default disabled:opacity-50'
            >
              <span className='font-mono text-xs'>{token}</span>
              <span>{label}</span>
            </button>
          ))}
        </div>
        <textarea
          ref={editorRef}
          aria-label={_('Prompt')}
          dir='auto'
          value={value}
          disabled={saving}
          onChange={(event) => setValue(event.target.value)}
          className='textarea eink-bordered border-base-200 bg-base-100 min-h-32 w-full select-text rounded-lg border text-sm leading-relaxed'
          required
        />
        <div className='text-base-content/70 text-sm'>
          <p className='mb-2 font-medium'>{_('Preview')}</p>
          <div
            role='region'
            aria-label={_('Prompt preview')}
            dir='auto'
            className='select-text whitespace-pre-wrap break-words text-sm leading-loose'
          >
            {value.split(/(\{(?:word|ctx)\})/g).map((part, index) =>
              part === '{word}' || part === '{ctx}' ? (
                <span
                  key={index}
                  title={part}
                  className='eink-bordered border-base-200 bg-base-200 text-base-content box-decoration-clone rounded-md border px-1.5 py-0.5'
                >
                  {part === '{word}' ? word || part : context || part}
                </span>
              ) : (
                <React.Fragment key={index}>{part}</React.Fragment>
              ),
            )}
          </div>
        </div>
        <div className='flex flex-wrap items-center justify-end gap-2'>
          <button
            type='button'
            disabled={saving || value === definition.instruction}
            className='btn btn-ghost eink-bordered min-h-11 text-sm'
            onClick={() => setValue(definition.instruction)}
          >
            {_('Use default prompt')}
          </button>
          <button
            type='submit'
            aria-label={_('Save prompt')}
            disabled={saving || !value.trim() || value === saved}
            className='btn btn-contrast min-h-11 text-sm'
          >
            {_('Save')}
          </button>
        </div>
      </form>
    </BoxedList>
  );
};

export default VocabularyPromptEditor;
