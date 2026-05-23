import { describe, expect, it } from 'bun:test';
import { cleanMessages } from '../../bin/review';
import type { Message } from '../types';

describe('cleanMessages in review.ts', () => {
    it('should pass through fully consistent messages', () => {
        const messages: Message[] = [
            { role: 'user', content: 'hello' },
            {
                role: 'assistant',
                content: 'let me run a tool',
                toolCalls: [{ toolCallId: '1', name: 'dummy', args: {} }]
            },
            { role: 'tool', toolCallId: '1', name: 'dummy', content: 'result' },
            { role: 'assistant', content: 'done' }
        ];

        const cleaned = cleanMessages(messages);
        expect(cleaned).toEqual(messages);
    });

    it('should recover unmatched tool responses with a dummy assistant message (orphan tool role)', () => {
        const messages: Message[] = [
            { role: 'user', content: 'hello' },
            // 親である assistant (toolCalls: '1') が manageContext 等で消えた想定
            { role: 'tool', toolCallId: '1', name: 'dummy', content: 'result' },
            { role: 'assistant', content: 'done' }
        ];

        const cleaned = cleanMessages(messages);
        expect(cleaned).toEqual([
            { role: 'user', content: 'hello' },
            {
                role: 'assistant',
                content: 'ツールを実行します。',
                toolCalls: [{ toolCallId: '1', name: 'dummy', args: {} }]
            },
            { role: 'tool', toolCallId: '1', name: 'dummy', content: 'result' },
            { role: 'assistant', content: 'done' }
        ]);
    });

    it('should fallback to a dummy user message if only system message remains', () => {
        const messages: Message[] = [
            { role: 'system', content: 'you are a reviewer' }
        ];

        const cleaned = cleanMessages(messages);
        expect(cleaned).toEqual([
            { role: 'system', content: 'you are a reviewer' },
            { role: 'user', content: '続けてください。' }
        ]);
    });

    it('should strip unmatched tool calls from assistant message (orphan tool_calls)', () => {
        const messages: Message[] = [
            { role: 'user', content: 'hello' },
            {
                role: 'assistant',
                content: 'let me run a tool',
                toolCalls: [{ toolCallId: '1', name: 'dummy', args: {} }]
            },
            // 子である tool (toolCallId: '1') が manageContext 等で消えた想定
            { role: 'assistant', content: 'done' }
        ];

        const cleaned = cleanMessages(messages);
        expect(cleaned).toEqual([
            { role: 'user', content: 'hello' },
            {
                role: 'assistant',
                content: 'let me run a tool'
            },
            { role: 'assistant', content: 'done' }
        ]);
    });

    it('should only keep matched tool calls and drop unmatched ones in case of multiple tool calls', () => {
        const messages: Message[] = [
            {
                role: 'assistant',
                content: 'running tools',
                toolCalls: [
                    { toolCallId: '1', name: 'dummy1', args: {} },
                    { toolCallId: '2', name: 'dummy2', args: {} }
                ]
            },
            { role: 'tool', toolCallId: '1', name: 'dummy1', content: 'res1' }
            // 'dummy2' の tool レスポンスが消えた想定
        ];

        const cleaned = cleanMessages(messages);
        expect(cleaned).toEqual([
            {
                role: 'assistant',
                content: 'running tools',
                toolCalls: [
                    { toolCallId: '1', name: 'dummy1', args: {} }
                ]
            },
            { role: 'tool', toolCallId: '1', name: 'dummy1', content: 'res1' }
        ]);
    });
});
