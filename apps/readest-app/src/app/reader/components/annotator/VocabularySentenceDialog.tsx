import React, { useState } from 'react';
import Dialog from '@/components/Dialog';
import { useTranslation } from '@/hooks/useTranslation';
import type { VocabularyCapture } from '@/utils/contextVocabulary';

const VocabularySentenceDialog: React.FC<{
  capture: VocabularyCapture;
  onConfirm: (capture: VocabularyCapture) => void;
  onClose: () => void;
}> = ({ capture, onConfirm, onClose }) => {
  const _ = useTranslation();
  const [sentence, setSentence] = useState(capture.sentence);
  const normalized = sentence.replace(/\s+/g, ' ').trim();
  const start = normalized.indexOf(capture.word);
  return (
    <Dialog isOpen title={_('Confirm the sentence')} onClose={onClose} aboveKeyboard>
      <form
        className='flex flex-col gap-3 p-4'
        onSubmit={(event) => {
          event.preventDefault();
          if (start >= 0)
            onConfirm({
              word: capture.word,
              sentence: normalized,
              wordStart: start,
              wordEnd: start + capture.word.length,
            });
        }}
      >
        <p className='text-base-content/70 text-sm'>
          {_('Check the original sentence before collecting this word')}
        </p>
        <p dir='auto' className='font-semibold'>
          {capture.word}
        </p>
        <textarea
          autoFocus
          dir='auto'
          aria-label={_('Original sentence')}
          className='textarea eink-bordered bg-base-100 min-h-32 w-full select-text rounded-lg border'
          value={sentence}
          onChange={(event) => setSentence(event.target.value)}
        />
        {start < 0 && (
          <p className='text-error text-sm'>{_('The sentence must contain the selected word')}</p>
        )}
        <div className='flex justify-end gap-2'>
          <button type='button' className='btn btn-ghost eink-bordered min-h-11' onClick={onClose}>
            {_('Cancel')}
          </button>
          <button type='submit' className='btn btn-contrast min-h-11' disabled={start < 0}>
            {_('Save')}
          </button>
        </div>
      </form>
    </Dialog>
  );
};

export default VocabularySentenceDialog;
