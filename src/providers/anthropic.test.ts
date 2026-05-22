import { mock, describe, it, expect } from 'bun:test';

// Anthropic モジュールのモック設定
const mockCreate = mock();
mock.module('@anthropic-ai/sdk', () => {
    return {
        default: class MockAnthropic {
            messages = {
                create: mockCreate,
            };
        },
    };
});

import { createAnthropic } from './anthropic';
import type { Message } from '../types';

describe('Anthropic Provider', () => {
    it('doGenerate works with text response', async () => {
        mockCreate.mockResolvedValue({
            content: [
                { type: 'text', text: 'こんにちは' },
            ],
            stop_reason: 'end_turn',
            usage: {
                input_tokens: 12,
                output_tokens: 6,
            },
        });

        const provider = createAnthropic({ apiKey: 'test-key' });
        const model = provider('claude-haiku-4-5-20251001');

        const messages: Message[] = [{ role: 'user', content: 'こんにちは' }];
        const result = await model.doGenerate({ messages });

        expect(result.text).toBe('こんにちは');
        expect(result.finishReason).toBe('stop');
        expect(result.usage).toEqual({
            promptTokens: 12,
            completionTokens: 6,
            totalTokens: 18,
        });

        // SDKが受け取ったパラメータの検証
        const [calledParams] = mockCreate.mock.calls[0] as any;
        expect(calledParams.model).toBe('claude-haiku-4-5-20251001');
        expect(calledParams.messages).toEqual([{ role: 'user', content: 'こんにちは' }]);
    });

    it('doGenerate works with tool calls', async () => {
        mockCreate.mockResolvedValue({
            content: [
                {
                    type: 'tool_use',
                    id: 'toolu_123',
                    name: 'readFile',
                    input: { path: 'test.txt' },
                },
            ],
            stop_reason: 'tool_use',
            usage: {
                input_tokens: 15,
                output_tokens: 10,
            },
        });

        const provider = createAnthropic({ apiKey: 'test-key' });
        const model = provider('claude-haiku-4-5-20251001');

        const messages: Message[] = [{ role: 'user', content: 'ファイル読んで' }];
        const result = await model.doGenerate({ messages });

        expect(result.text).toBe('');
        expect(result.finishReason).toBe('tool_calls');
        expect(result.toolCalls).toEqual([
            {
                toolCallId: 'toolu_123',
                name: 'readFile',
                args: { path: 'test.txt' },
            },
        ]);
    });
});
