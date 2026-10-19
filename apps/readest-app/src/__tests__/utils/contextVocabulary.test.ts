import { describe, expect, it } from 'vitest';
import {
  captureVocabulary,
  readVocabulary,
  renderVocabularyPrompt,
  vocabularyId,
} from '@/utils/contextVocabulary';
import { transformBookNoteFromDB, transformBookNoteToDB } from '@/utils/transform';
import type { Book, BookConfig, BookNote } from '@/types/book';
import { buildRemotePayload, parseRemotePayload } from '@/services/sync/file/wire';
import { mergeNotes } from '@/services/sync/file/merge';
import { buildAnnotationIndex } from '@/app/reader/utils/annotationIndex';

const select = (node: Node, start: number, end: number) => {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  return range;
};

describe('context vocabulary', () => {
  it('substitutes every word and context variable exactly once using literal book text', () => {
    expect(renderVocabularyPrompt('解释 {word} 在{ctx}；再次：{word}', 'love', 'i love u.')).toBe(
      '解释 love 在i love u.；再次：love',
    );
    expect(renderVocabularyPrompt('{word} / {ctx} / {unknown}', '{ctx} $&', '<b>{word}</b>')).toBe(
      '{ctx} $& / <b>{word}</b> / {unknown}',
    );
  });

  it('captures the enclosing sentence and the selected occurrence of a repeated word', () => {
    document.body.innerHTML = '<p>First sentence. A subtle, very subtle change. Last sentence.</p>';
    const text = document.querySelector('p')!.firstChild!;
    const index = text.textContent!.lastIndexOf('subtle');
    expect(captureVocabulary(select(text, index, index + 6))).toEqual({
      word: 'subtle',
      sentence: 'A subtle, very subtle change.',
      wordStart: 15,
      wordEnd: 21,
    });
  });

  it('excludes injected translations, ruby readings and footnote markers', () => {
    document.body.innerHTML =
      '<p>She <ruby>remained<rt>reading</rt></ruby> <em>resilient</em><a role="doc-noteref">1</a> today.<span class="translation-target">译文</span></p>';
    const text = document.querySelector('em')!.firstChild!;
    expect(captureVocabulary(select(text, 0, 9))).toEqual({
      word: 'resilient',
      sentence: 'She remained resilient today.',
      wordStart: 13,
      wordEnd: 22,
    });
  });

  it('normalizes whitespace while preserving the selected word offset', () => {
    document.body.innerHTML = '<p>  She\n  remained <em>resilient</em> today.  </p>';
    expect(
      captureVocabulary(select(document.querySelector('em')!.firstChild!, 0, 9)),
    ).toMatchObject({
      sentence: 'She remained resilient today.',
      wordStart: 13,
      wordEnd: 22,
    });
  });

  it('reads a sentence from generic block markup instead of only the selected inline span', () => {
    document.body.innerHTML = '<div>She remained <span>resilient</span><sup>1</sup> today.</div>';
    expect(
      captureVocabulary(select(document.querySelector('span')!.firstChild!, 0, 9)),
    ).toMatchObject({
      sentence: 'She remained resilient today.',
      wordStart: 13,
      wordEnd: 22,
    });
  });

  it('handles Chinese punctuation and asks for confirmation for cross-block selections', () => {
    document.body.innerHTML = '<p>前一句。他依然坚韧。后一句。</p><p>Another block.</p>';
    expect(captureVocabulary(select(document.querySelector('p')!.firstChild!, 7, 9))).toMatchObject(
      {
        word: '坚韧',
        sentence: '他依然坚韧。',
        wordStart: 3,
        wordEnd: 5,
      },
    );
    const range = document.createRange();
    range.setStart(document.querySelector('p')!.firstChild!, 0);
    range.setEnd(document.querySelectorAll('p')[1]!.firstChild!, 3);
    expect(captureVocabulary(range)?.needsConfirmation).toBe(true);
  });

  it('round trips the complete card through local JSON and cloud note transforms', () => {
    const note: BookNote = {
      id: 'context-1',
      type: 'context',
      bookHash: 'book',
      cfi: 'epubcfi(/6/2!/4/2/1:0)',
      text: 'A subtle change.',
      note: JSON.stringify({
        version: 1,
        word: 'subtle',
        wordStart: 2,
        wordEnd: 8,
        sourceLang: 'en',
        targetLang: 'zh-CN',
        wordTranslation: '微妙的',
        sentenceTranslation: '一个微妙的变化。',
      }),
      createdAt: 100,
      updatedAt: 200,
    };
    const restored = transformBookNoteFromDB(
      transformBookNoteToDB(JSON.parse(JSON.stringify(note)), 'user'),
    );
    expect(readVocabulary(restored)).toEqual(JSON.parse(note.note));
    expect(restored.text).toBe(note.text);
    const remote = parseRemotePayload(
      JSON.stringify(
        buildRemotePayload({ hash: 'book' } as Book, { booknotes: [note] } as BookConfig, 'device'),
      ),
    )!;
    const merged = mergeNotes([], remote.booknotes)[0]!;
    expect(readVocabulary(merged)).toEqual(readVocabulary(note));
    expect(buildAnnotationIndex([merged]).bySection.size).toBe(0);
    expect(
      mergeNotes([merged], [{ ...merged, updatedAt: 300, deletedAt: 300 }])[0]?.deletedAt,
    ).toBe(300);
    expect(readVocabulary({ ...note, note: '{broken' })).toBeNull();
    expect(readVocabulary({ ...note, text: 'Changed sentence.' })).toBeNull();
  });

  it('deduplicates split views of the same book, keeping distinct positions and languages', () => {
    const id = vocabularyId('hash-1', 'cfi1', 'word', 'zh');
    expect(vocabularyId('hash-2', 'cfi1', 'word', 'zh')).toBe(id);
    expect(vocabularyId('hash-1', 'cfi2', 'word', 'zh')).not.toBe(id);
    expect(vocabularyId('hash-1', 'cfi1', 'word', 'ja')).not.toBe(id);
  });
});
