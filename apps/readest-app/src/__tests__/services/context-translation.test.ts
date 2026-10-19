import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/services/ai/utils/httpFetch', () => ({ getAIFetch: () => h.fetch }));
vi.mock('@/services/ai/providers', () => ({ getAIProvider: vi.fn() }));
vi.mock('@/utils/access', () => ({ getAccessToken: vi.fn() }));
import {
  translateVocabulary,
  isVocabularyAIConfigured,
  parseVocabularyTranslation,
} from '@/services/ai/contextTranslation';
import { getVocabularyOptions, type VocabularyContent } from '@/utils/contextVocabulary';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';

beforeEach(() => vi.clearAllMocks());

describe('context translation', () => {
  it('accepts fenced JSON and reasoning without rendering model markup', () => {
    expect(
      parseVocabularyTranslation(
        '<think>reasoning</think>\n```json\n{"wordTranslation":" 微妙的 ","sentenceTranslation":"一个微妙的变化。"}\n```',
      ),
    ).toEqual({ wordTranslation: '微妙的', sentenceTranslation: '一个微妙的变化。' });
  });
  it('rejects incomplete or invalid replies', () => {
    for (const text of [
      'hello',
      '{}',
      '{"wordTranslation":"x"}',
      '{"wordTranslation":"x","sentenceTranslation":false}',
    ]) {
      expect(() => parseVocabularyTranslation(text)).toThrow();
    }
  });
  it('accepts only the enabled analyses and requires their content', () => {
    const options = {
      wordTranslation: false,
      sentenceTranslation: false,
      grammarAnalysis: true,
      vocabularyAnalysis: false,
    };
    expect(
      parseVocabularyTranslation(
        '{"grammarAnalysis":"主句使用一般过去时","vocabularyAnalysis":"not requested"}',
        options,
      ),
    ).toEqual({ grammarAnalysis: '主句使用一般过去时' });
    expect(() => parseVocabularyTranslation('{}', options)).toThrow();
  });
  it('requests only the enabled sections through the existing AI configuration', async () => {
    const options = {
      wordTranslation: false,
      sentenceTranslation: false,
      grammarAnalysis: true,
      vocabularyAnalysis: true,
    };
    h.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ grammarAnalysis: '主句结构', vocabularyAnalysis: '词汇用法' })),
    );
    const content: VocabularyContent = {
      version: 1,
      word: 'subtle',
      wordStart: 2,
      wordEnd: 8,
      sourceLang: 'en',
      targetLang: 'zh',
    };
    const result = await translateVocabulary(
      {
        ...DEFAULT_AI_SETTINGS,
        enabled: true,
        provider: 'ai-gateway',
        aiGatewayApiKey: 'test-key',
      },
      content,
      'A subtle change.',
      new AbortController().signal,
      options,
    );
    expect(result).toEqual({ grammarAnalysis: '主句结构', vocabularyAnalysis: '词汇用法' });
    const request = JSON.parse(h.fetch.mock.calls[0]![1].body);
    expect(request.system).toContain('grammarAnalysis');
    expect(request.system).toContain('vocabularyAnalysis');
    expect(request.system).not.toContain('wordTranslation');
    expect(request.system).not.toContain('sentenceTranslation');
    expect(request.apiKey).toBe('test-key');
    h.fetch.mockClear();
    await expect(
      translateVocabulary(
        DEFAULT_AI_SETTINGS,
        content,
        'A subtle change.',
        new AbortController().signal,
        { ...options, grammarAnalysis: false, vocabularyAnalysis: false },
      ),
    ).resolves.toEqual({});
    expect(h.fetch).not.toHaveBeenCalled();
    expect(getVocabularyOptions()).toEqual({
      wordTranslation: true,
      sentenceTranslation: true,
      grammarAnalysis: false,
      vocabularyAnalysis: false,
    });
  });
  it('sends the expanded custom prompt for the enabled section', async () => {
    h.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ wordTranslation: '爱' })));
    await translateVocabulary(
      {
        ...DEFAULT_AI_SETTINGS,
        enabled: true,
        provider: 'ai-gateway',
        aiGatewayApiKey: 'test-key',
      },
      { version: 1, word: 'love', wordStart: 2, wordEnd: 6, sourceLang: 'en', targetLang: 'zh' },
      'i love u.',
      new AbortController().signal,
      {
        wordTranslation: true,
        sentenceTranslation: false,
        grammarAnalysis: false,
        vocabularyAnalysis: false,
      },
      { wordTranslation: '解释 {word} 在{ctx} 中的意思', grammarAnalysis: 'not enabled' },
    );
    const request = JSON.parse(h.fetch.mock.calls[0]![1].body);
    const input = JSON.parse(request.messages[0].content);
    expect(input.tasks).toEqual({ wordTranslation: '解释 love 在i love u. 中的意思' });
    expect(input.word).toBe('love');
    expect(input.sentence).toBe('i love u.');
  });
  it('uses only the existing AI settings and does not require embeddings', () => {
    expect(isVocabularyAIConfigured()).toBe(false);
    expect(isVocabularyAIConfigured(DEFAULT_AI_SETTINGS)).toBe(false);
    expect(isVocabularyAIConfigured({ ...DEFAULT_AI_SETTINGS, enabled: true })).toBe(true);
    expect(
      isVocabularyAIConfigured({
        ...DEFAULT_AI_SETTINGS,
        enabled: true,
        provider: 'openrouter',
        openrouterApiKey: 'key',
        openrouterEmbeddingModel: '',
      }),
    ).toBe(true);
  });
});
