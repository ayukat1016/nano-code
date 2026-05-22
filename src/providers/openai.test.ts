import { mock, describe, it, expect } from 'bun:test';

// OpenAI モジュールのモック設定
const mockCreate = mock();
mock.module('openai', () => {
    return {
        default: class MockOpenAI {
            chat = {
                completions: {
                    create: mockCreate,
                },
            };
        },
    };
});

import { createOpenAI } from './openai';
import type { Message } from '../types';

describe('OpenAI Provider', () => {
    it('doGenerate works with text response', async () => {
        mockCreate.mockResolvedValue({
            choices: [
                {
                    message: { role: 'assistant', content: 'こんにちは' },
                    finish_reason: 'stop',
                },
            ],
            usage: {
                prompt_tokens: 10,
                completion_tokens: 5,
                total_tokens: 15,
            },
        });

        const provider = createOpenAI({ apiKey: 'test-key' });
        const model = provider('gpt-5-mini');

        const messages: Message[] = [{ role: 'user', content: 'こんにちは' }];
        const result = await model.doGenerate({ messages });

        expect(result.text).toBe('こんにちは');
        expect(result.finishReason).toBe('stop');
        expect(result.usage).toEqual({
            promptTokens: 10,
            completionTokens: 5,
            totalTokens: 15,
        });

        // SDKが受け取ったパラメータの検証
        const [calledParams] = mockCreate.mock.calls[0] as any;
        expect(calledParams.model).toBe('gpt-5-mini');
        expect(calledParams.messages).toEqual([{ role: 'user', content: 'こんにちは' }]);
    });

    it('doGenerate works with tool calls', async () => {
        mockCreate.mockResolvedValue({
            choices: [
                {
                    message: {
                        role: 'assistant',
                        content: null,
                        tool_calls: [
                            {
                                id: 'call_123',
                                type: 'function',
                                function: {
                                    name: 'readFile',
                                    arguments: '{"path":"test.txt"}',
                                },
                            },
                        ],
                    },
                    finish_reason: 'tool_calls',
                },
            ],
        });

        const provider = createOpenAI({ apiKey: 'test-key' });
        const model = provider('gpt-5-mini');

        const messages: Message[] = [{ role: 'user', content: 'ファイル読んで' }];
        const result = await model.doGenerate({ messages });

        expect(result.text).toBe('');
        expect(result.finishReason).toBe('tool_calls');
        expect(result.toolCalls).toEqual([
            {
                toolCallId: 'call_123',
                name: 'readFile',
                args: { path: 'test.txt' },
            },
        ]);
    });
});
