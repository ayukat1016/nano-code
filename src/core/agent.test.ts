import { describe, expect, it } from 'bun:test';
import { Agent } from './agent';
import type { LanguageModel, Tool, Message } from '../types';

describe('Agent', () => {
    it('正常な思考ループとツールの実行ができること', async () => {
        let step = 0;
        const callHistory: Message[][] = [];

        const model: LanguageModel = {
            async doGenerate(params) {
                callHistory.push([...params.messages]);
                step++;
                if (step === 1) {
                    return {
                        text: '検索ツールを使います。',
                        finishReason: 'stop',
                        toolCalls: [
                            {
                                toolCallId: 'call_1',
                                name: 'search',
                                args: { query: 'test' }
                            }
                        ]
                    };
                } else {
                    return {
                        text: '検索結果を確認しました。タスク完了です。',
                        finishReason: 'stop'
                    };
                }
            }
        };

        const searchTool: Tool = {
            name: 'search',
            description: 'テスト用の検索ツール',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string' }
                },
                required: ['query']
            },
            execute: async (args) => {
                return `「${args.query}」の検索結果: 成功`;
            }
        };

        const agent = new Agent({
            name: 'test-agent',
            model,
            instructions: '指示内容',
            tools: { search: searchTool },
            maxSteps: 5,
        });

        const result = await agent.generate('テスト検索を行ってください');

        expect(result.text).toBe('検索結果を確認しました。タスク完了です。');
        expect(step).toBe(2);
        
        // 2回目の doGenerate に渡された履歴にツール実行結果が含まれていること
        expect(callHistory.length).toBe(2);
        const secondCallMessages = callHistory[1]!;
        const lastMessage = secondCallMessages[secondCallMessages.length - 1]!;
        expect(lastMessage.role).toBe('tool');
        if (lastMessage.role === 'tool') {
            expect(lastMessage.name).toBe('search');
            expect(lastMessage.content).toBe('「test」の検索結果: 成功');
        }
    });

    it('maxSteps 上限でループが終了すること', async () => {
        let step = 0;
        const model: LanguageModel = {
            async doGenerate(params) {
                step++;
                // 毎回ツール呼び出しを返すことで、ループを継続させる
                return {
                    text: `思考ステップ ${step}`,
                    finishReason: 'stop',
                    toolCalls: [
                        {
                            toolCallId: `call_${step}`,
                            name: 'dummy',
                            args: {}
                        }
                    ]
                };
            }
        };

        const dummyTool: Tool = {
            name: 'dummy',
            description: 'ダミーツール',
            parameters: {},
            execute: async () => '完了'
        };

        const agent = new Agent({
            name: 'limit-agent',
            model,
            instructions: '指示内容',
            tools: { dummy: dummyTool },
            maxSteps: 3,
        });

        const result = await agent.generate('終わらないタスク');

        expect(step).toBe(3); // maxSteps=3 で終了すること
    });

    it('承認ゲートで承認された場合はツールが実行されること', async () => {
        let executed = false;
        const model: LanguageModel = {
            async doGenerate() {
                return {
                    text: '書き込みます。',
                    finishReason: 'stop',
                    toolCalls: [
                        {
                            toolCallId: 'call_1',
                            name: 'write',
                            args: { content: 'hello' }
                        }
                    ]
                };
            }
        };

        const writeTool: Tool = {
            name: 'write',
            description: 'テスト用の書き込みツール',
            needsApproval: true,
            parameters: {},
            execute: async () => {
                executed = true;
                return '書き込み成功';
            }
        };

        const approvalFunc = async (name: string, args: any) => {
            return true; // 承認する
        };

        const agent = new Agent({
            name: 'approval-agent',
            model,
            instructions: '指示内容',
            tools: { write: writeTool },
            approvalFunc,
            maxSteps: 2, // ツール呼び出し後に継続するが最大ステップで抜ける
        });

        await agent.generate('書き込んで');

        expect(executed).toBe(true);
    });

    it('承認ゲートで拒否された場合はツールが実行されず、拒否結果が履歴に追加されること', async () => {
        let executed = false;
        const callHistory: Message[][] = [];
        const model: LanguageModel = {
            async doGenerate(params) {
                callHistory.push([...params.messages]);
                if (callHistory.length === 1) {
                    return {
                        text: '書き込みます。',
                        finishReason: 'stop',
                        toolCalls: [
                            {
                                toolCallId: 'call_1',
                                name: 'write',
                                args: { content: 'hello' }
                            }
                        ]
                    };
                } else {
                    return {
                        text: '拒否されたので諦めます。',
                        finishReason: 'stop'
                    };
                }
            }
        };

        const writeTool: Tool = {
            name: 'write',
            description: 'テスト用の書き込みツール',
            needsApproval: true,
            parameters: {},
            execute: async () => {
                executed = true;
                return '書き込み成功';
            }
        };

        const approvalFunc = async (name: string, args: any) => {
            return false; // 拒否する
        };

        const agent = new Agent({
            name: 'reject-agent',
            model,
            instructions: '指示内容',
            tools: { write: writeTool },
            approvalFunc,
            maxSteps: 2,
        });

        await agent.generate('書き込んで');

        expect(executed).toBe(false); // ツールは実行されないこと
        expect(callHistory.length).toBe(2);
        
        const secondCallMessages = callHistory[1]!;
        const lastMessage = secondCallMessages[secondCallMessages.length - 1]!;
        expect(lastMessage.role).toBe('tool');
        if (lastMessage.role === 'tool') {
            expect(lastMessage.name).toBe('write');
            expect(lastMessage.content).toBe('ユーザーによってキャンセルされました。別の方法を検討してください。');
        }
    });

    it('useStreaming が true で、モデルがストリーミングをサポートしている場合にストリーミングで応答を収集できること', async () => {
        let streamCalled = false;
        const model: LanguageModel = {
            async doGenerate() {
                throw new Error('Streaming should be used instead of doGenerate');
            },
            async *doStream(_params) {
                streamCalled = true;
                yield { kind: 'delta', text: 'スト' };
                yield { kind: 'delta', text: 'リーム' };
                yield { kind: 'done', finishReason: 'stop' };
            }
        };

        const agent = new Agent({
            name: 'stream-agent',
            model,
            instructions: '指示内容',
            tools: {},
            useStreaming: true,
            maxSteps: 2,
        });

        const result = await agent.generate('ストリームで返して');
        expect(streamCalled).toBe(true);
        expect(result.text).toBe('ストリーム');
    });

    it('finishReason が content_filter の場合にループが中断すること', async () => {
        let step = 0;
        const model: LanguageModel = {
            async doGenerate() {
                step++;
                return {
                    text: '不適切なコンテンツが含まれています。',
                    finishReason: 'content_filter'
                };
            }
        };

        const agent = new Agent({
            name: 'filter-agent',
            model,
            instructions: '指示内容',
            tools: {},
            maxSteps: 5,
        });

        const result = await agent.generate('危ないことして');
        expect(step).toBe(1); // 1ステップ目で即座に中断されること
        expect(result.text).toBe('不適切なコンテンツが含まれています。');
    });

    it('finishReason が length の場合に警告を出してループが継続すること', async () => {
        let step = 0;
        const model: LanguageModel = {
            async doGenerate() {
                step++;
                if (step === 1) {
                    return {
                        text: '出力が非常に長いため途中で切れました。',
                        finishReason: 'length',
                        toolCalls: [
                            {
                                toolCallId: 'call_1',
                                name: 'dummy',
                                args: {}
                            }
                        ]
                    };
                } else {
                    return {
                        text: '続きです。完了しました。',
                        finishReason: 'stop'
                    };
                }
            }
        };

        const dummyTool: Tool = {
            name: 'dummy',
            description: 'ダミーツール',
            parameters: {},
            execute: async () => 'ツール実行完了'
        };

        const agent = new Agent({
            name: 'length-agent',
            model,
            instructions: '指示内容',
            tools: { dummy: dummyTool },
            maxSteps: 5,
        });

        const result = await agent.generate('長い話を教えて');
        expect(step).toBe(2); // 警告しつつループが継続して2ステップ目まで進むこと
        expect(result.text).toBe('続きです。完了しました。');
    });

    it('履歴がCHAR_LIMITを超えた場合に manageContext が履歴を圧縮すること', async () => {
        let lastReceivedMessages: Message[] = [];
        let step = 0;
        const model: LanguageModel = {
            async doGenerate(params) {
                lastReceivedMessages = params.messages;
                step++;
                if (step < 5) {
                    return {
                        text: 'ツールを使います。',
                        finishReason: 'stop',
                        toolCalls: [
                            {
                                toolCallId: `call_${step}`,
                                name: 'dummy',
                                args: {}
                            }
                        ]
                    };
                }
                return {
                    text: '完了しました。',
                    finishReason: 'stop'
                };
            }
        };

        const dummyTool: Tool = {
            name: 'dummy',
            description: 'ダミーツール',
            parameters: {},
            execute: async () => {
                return '結果'.repeat(6000); // 12000文字
            }
        };

        const agent = new Agent({
            name: 'context-agent',
            model,
            instructions: 'システム指示',
            tools: { dummy: dummyTool },
            maxSteps: 10,
        });

        await agent.generate('開始します');

        const totalLength = lastReceivedMessages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
        expect(totalLength).toBeLessThanOrEqual(30000);

        const hasOmitted = lastReceivedMessages.some(m => m.content && m.content.includes('以前のツール実行結果は省略されました'));
        expect(hasOmitted).toBe(true);
    });
});
