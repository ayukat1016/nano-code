import { describe, expect, it } from 'bun:test';
import { generateText } from './generate-text';
import type { GenerateParams, LanguageModel, Message } from '../types';

describe('generateText', () => {
    it('passes GenerateParams through to model.doGenerate', async () => {
        let received: GenerateParams | null = null;
        const model: LanguageModel = {
            async doGenerate(params) {
                received = params;
                return { text: 'ok', finishReason: 'stop' };
            },
        };

        const messages: Message[] = [{ role: 'user', content: 'hello' }];
        const result = await generateText({
            model,
            messages,
            temperature: 0.25,
            maxTokens: 123,
        });

        expect(result.text).toBe('ok');
        expect(received).not.toBeNull();
        expect(received!).toEqual({
            messages,
            temperature: 0.25,
            maxTokens: 123,
            tools: undefined,
            signal: undefined,
        });
    });
});
