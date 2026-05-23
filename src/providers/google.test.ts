import { mock, describe, it, expect } from 'bun:test';

// Google Gen AI モジュールのモック設定
const mockGenerateContent = mock();
mock.module('@google/genai', () => {
    return {
        GoogleGenAI: class MockGoogleGenAI {
            models = {
                generateContent: mockGenerateContent,
            };
        },
    };
});

import { createGoogle } from './google';
import type { Message } from '../types';

describe('Google Provider', () => {
    it('doGenerate works with text response', async () => {
        mockGenerateContent.mockResolvedValue({
            candidates: [
                {
                    content: {
                        parts: [
                            { text: 'こんにちは' },
                        ],
                    },
                    finishReason: 'STOP',
                },
            ],
            usageMetadata: {
                promptTokenCount: 14,
                candidatesTokenCount: 7,
                totalTokenCount: 21,
            },
        });

        const provider = createGoogle({ apiKey: 'test-key' });
        const model = provider('gemini-2.5-flash');

        const messages: Message[] = [{ role: 'user', content: 'こんにちは' }];
        const result = await model.doGenerate({ messages });

        expect(result.text).toBe('こんにちは');
        expect(result.finishReason).toBe('stop');
        expect(result.usage).toEqual({
            promptTokens: 14,
            completionTokens: 7,
            totalTokens: 21,
        });

        // SDKが受け取ったパラメータの検証
        const [calledParams] = mockGenerateContent.mock.calls[0] as any;
        expect(calledParams.model).toBe('gemini-2.5-flash');
        expect(calledParams.contents).toEqual([{ role: 'user', parts: [{ text: 'こんにちは' }] }]);
    });

    it('doGenerate works with tool calls', async () => {
        mockGenerateContent.mockResolvedValue({
            candidates: [
                {
                    content: {
                        parts: [
                            {
                                functionCall: {
                                    name: 'readFile',
                                    args: { path: 'test.txt' },
                                },
                            },
                        ],
                    },
                    finishReason: 'STOP', // Geminiはツール呼び出し時も通常STOPを返す（hasFunctionCallフラグで判定）
                },
            ],
            usageMetadata: {
                promptTokenCount: 20,
                candidatesTokenCount: 15,
                totalTokenCount: 35,
            },
        });

        const provider = createGoogle({ apiKey: 'test-key' });
        const model = provider('gemini-2.5-flash');

        const messages: Message[] = [{ role: 'user', content: 'ファイル読んで' }];
        const result = await model.doGenerate({ messages });

        expect(result.text).toBe('');
        expect(result.finishReason).toBe('tool_calls');
        expect(result.toolCalls).toEqual([
            {
                toolCallId: 'call_0', // 連番で生成されるID
                name: 'readFile',
                args: { path: 'test.txt' },
            },
        ]);
    });

    it('doGenerate handles missing or nullish args in tool calls', async () => {
        mockGenerateContent.mockResolvedValue({
            candidates: [
                {
                    content: {
                        parts: [
                            {
                                functionCall: {
                                    name: 'readFile',
                                    args: null,
                                },
                            },
                        ],
                    },
                    finishReason: 'STOP',
                },
            ],
        });

        const provider = createGoogle({ apiKey: 'test-key' });
        const model = provider('gemini-2.5-flash');

        const messages: Message[] = [{ role: 'user', content: 'ファイル読んで' }];
        const result = await model.doGenerate({ messages });

        expect(result.toolCalls).toBeDefined();
        expect(result.toolCalls![0]!.args).toEqual({});
    });
});
