import type { BookNote } from '@/types/book';
import { md5 } from 'js-md5';
import { SENTENCE_CONTAINER } from '@/utils/sentence';
import { getPdfTextFromRange, getPdfTextLayer } from '@/utils/pdfText';
import type { VocabularyField, VocabularyOptions } from '@/types/settings';
import { stubTranslation as _ } from '@/utils/misc';

export const VOCABULARY_FIELDS: { key: VocabularyField; label: string; instruction: string }[] = [
  {
    key: 'wordTranslation',
    label: _('Word meaning'),
    instruction: 'Translate "{word}" according to its meaning in this sentence: {ctx}',
  },
  {
    key: 'sentenceTranslation',
    label: _('Sentence translation'),
    instruction: 'Translate this complete sentence naturally: {ctx}',
  },
  {
    key: 'grammarAnalysis',
    label: _('Grammar analysis'),
    instruction:
      'Explain the sentence structure, grammatical relationships and relevant grammar patterns in this sentence: {ctx}',
  },
  {
    key: 'vocabularyAnalysis',
    label: _('Vocabulary analysis'),
    instruction:
      'Explain "{word}": its part of speech, meaning in context, collocations and usage in this sentence: {ctx}',
  },
];
export const getVocabularyOptions = (settings?: Partial<VocabularyOptions>): VocabularyOptions => ({
  wordTranslation: settings?.wordTranslation ?? true,
  sentenceTranslation: settings?.sentenceTranslation ?? true,
  grammarAnalysis: settings?.grammarAnalysis ?? false,
  vocabularyAnalysis: settings?.vocabularyAnalysis ?? false,
});

export const hasVocabularyOutput = (
  content: Partial<Record<VocabularyField, string>>,
  options: VocabularyOptions,
) => VOCABULARY_FIELDS.every(({ key }) => !options[key] || !!content[key]?.trim());

/** One pass: text substituted from the book is never interpreted as another variable. */
export const renderVocabularyPrompt = (template: string, word: string, context: string): string =>
  template.replace(/\{(word|ctx)\}/g, (_match, key: string) => (key === 'word' ? word : context));

export interface VocabularyContent {
  version: 1;
  word: string;
  wordStart: number;
  wordEnd: number;
  sourceLang: string;
  targetLang: string;
  wordTranslation?: string;
  sentenceTranslation?: string;
  grammarAnalysis?: string;
  vocabularyAnalysis?: string;
}

export interface VocabularyCapture {
  word: string;
  sentence: string;
  wordStart: number;
  wordEnd: number;
  needsConfirmation?: boolean;
}

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
const EXCLUDED =
  'rt, rp, script, style, [cfi-inert], .translation-target, [aria-hidden="true"], [role="doc-noteref"], [epub\\:type~="noteref"]';

const sentenceAt = (
  text: string,
  start: number,
  end: number,
  locale?: string,
): VocabularyCapture | null => {
  try {
    const segments = Array.from(
      new Intl.Segmenter(locale || undefined, { granularity: 'sentence' }).segment(text),
    );
    const first = segments.find((s) => s.index <= start && start < s.index + s.segment.length);
    const last = segments.find((s) => s.index < end && end <= s.index + s.segment.length);
    if (!first || !last) return null;
    return {
      word: text.slice(start, end),
      sentence: text.slice(first.index, last.index + last.segment.length).trimEnd(),
      wordStart: start - first.index,
      wordEnd: end - first.index,
    };
  } catch {
    return null;
  }
};

/** Snapshot the source text before opening a panel can invalidate the selection. */
export const captureVocabulary = (range: Range): VocabularyCapture | null => {
  const word = normalize(range.toString());
  if (!word) return null;
  const fallback = (): VocabularyCapture => ({
    word,
    sentence: word,
    wordStart: 0,
    wordEnd: word.length,
    needsConfirmation: true,
  });
  const textLayer = getPdfTextLayer(range);
  if (textLayer) {
    const full = range.cloneRange();
    full.selectNodeContents(textLayer);
    const prefixRange = full.cloneRange();
    prefixRange.setEnd(range.startContainer, range.startOffset);
    const text = normalize(getPdfTextFromRange(full, textLayer));
    const prefixLength = normalize(getPdfTextFromRange(prefixRange, textLayer)).length;
    const selectedWord = normalize(getPdfTextFromRange(range, textLayer));
    const start = text.indexOf(selectedWord, Math.max(0, prefixLength - 1));
    if (!selectedWord || start < 0 || start > prefixLength + 1) return fallback();
    const capture = sentenceAt(
      text,
      start,
      start + selectedWord.length,
      textLayer.ownerDocument.documentElement.lang,
    );
    // The page may begin or end in the middle of a sentence: let the reader confirm it.
    return capture ? { ...capture, needsConfirmation: true } : fallback();
  }
  const element =
    range.startContainer.nodeType === 1
      ? (range.startContainer as Element)
      : range.startContainer.parentElement;
  const root = element?.closest(`${SENTENCE_CONTAINER}, td, th, pre, figcaption, div`) ?? element;
  if (!root?.contains(range.endContainer)) return fallback();
  const doc = root.ownerDocument;
  const before = doc.createRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const rawStart = before.toString().length;
  const rawEnd = rawStart + range.toString().length;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let rawOffset = 0;
  let prefix = '';
  let selected = '';
  let suffix = '';
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.nodeType === 1 ? (node as Element) : node.parentElement;
    const superscript = parent?.closest('sup');
    let hidden =
      !!parent?.closest(EXCLUDED) ||
      !!(superscript && /^[\s\d*†‡()[\]]+$/u.test(superscript.textContent ?? ''));
    for (let el = parent; el && !hidden; el = el.parentElement) {
      const style = doc.defaultView?.getComputedStyle(el);
      hidden =
        el.hasAttribute('hidden') || style?.display === 'none' || style?.visibility === 'hidden';
      if (el === root) break;
    }
    if (node.nodeType === 1) {
      if (!hidden && (node as Element).localName === 'br') {
        if (rawOffset <= rawStart) prefix += ' ';
        else if (rawOffset < rawEnd) selected += ' ';
        else suffix += ' ';
      }
      continue;
    }
    const value = node.nodeValue ?? '';
    if (!hidden) {
      const start = Math.max(0, Math.min(value.length, rawStart - rawOffset));
      const end = Math.max(0, Math.min(value.length, rawEnd - rawOffset));
      prefix += value.slice(0, start);
      selected += value.slice(start, end);
      suffix += value.slice(end);
    }
    rawOffset += value.length;
  }
  const raw = `${prefix}${selected}${suffix}`;
  const collapsed = raw.replace(/\s+/g, ' ');
  const leading = collapsed.length - collapsed.trimStart().length;
  const text = collapsed.trim();
  const start =
    prefix.replace(/\s+/g, ' ').length -
    leading +
    (selected.length - selected.trimStart().length > 0 ? 1 : 0);
  const selectedWord = normalize(selected);
  const end = start + selectedWord.length;
  if (!selectedWord || text.slice(start, end) !== selectedWord) return fallback();
  return sentenceAt(text, start, end, doc.documentElement.lang) ?? fallback();
};

export const readVocabulary = (note: BookNote): VocabularyContent | null => {
  if (note.type !== 'context' || !note.text) return null;
  try {
    const data: unknown = JSON.parse(note.note);
    if (!data || typeof data !== 'object') return null;
    const value = data as Record<string, unknown>;
    if (
      value['version'] !== 1 ||
      typeof value['word'] !== 'string' ||
      !value['word'].trim() ||
      typeof value['sourceLang'] !== 'string' ||
      typeof value['targetLang'] !== 'string' ||
      typeof value['wordStart'] !== 'number' ||
      !Number.isInteger(value['wordStart']) ||
      typeof value['wordEnd'] !== 'number' ||
      !Number.isInteger(value['wordEnd']) ||
      value['wordStart'] < 0 ||
      value['wordEnd'] <= value['wordStart'] ||
      value['wordEnd'] > note.text.length ||
      note.text.slice(value['wordStart'], value['wordEnd']) !== value['word'] ||
      VOCABULARY_FIELDS.some(
        ({ key }) => value[key] !== undefined && typeof value[key] !== 'string',
      )
    )
      return null;
    return value as unknown as VocabularyContent;
  } catch {
    return null;
  }
};

export const vocabularyId = (bookKey: string, cfi: string, word: string, targetLang: string) =>
  `context-${md5(JSON.stringify([bookKey.split('-')[0], cfi, word, targetLang]))}`;
