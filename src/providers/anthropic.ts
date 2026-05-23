import Anthropic from '@anthropic-ai/sdk';
import type {
    FinishReason,
    GenerateParams,
    GenerateTextResult,
    LanguageModel,
    Message,
    Provider,
    StreamChunk,
    ToolCall,
} from '../types';
import { LLMApiError } from '../types';

export function createAnthropic(config?: {
    apiKey?: string;
    maxRetries?: number;
}): Provider {
    const client = new Anthropic({
        apiKey: config?.apiKey, // 省略時は環境変数ANTHROPIC_API_KEYを自動参照
        maxRetries: config?.maxRetries ?? 0,
    });

    // systemメッセージを分離して変換
    function convertMessages(messages: Message[]) {
        return messages
            .filter((m) => m.role !== 'system')
            .map((m) => {
                // ツール結果はuserロール + tool_resultブロック
                if (m.role === 'tool') {
                    return {
                        role: 'user' as const,
                        content: [
                            {
                                type: 'tool_result' as const,
                                tool_use_id: m.toolCallId,
                                content: m.content,
                            },
                        ],
                    };
                }
                // assistantのツール呼び出し
                if (m.role === 'assistant' && m.toolCalls) {
                    const content: any[] = [];
                    if (m.content) {
                        content.push({ type: 'text', text: m.content });
                    }
                    for (const tc of m.toolCalls) {
                        content.push({
                            type: 'tool_use',
                            id: tc.toolCallId,
                            name: tc.name,
                            input: tc.args,
                        });
                    }
                    return { role: 'assistant' as const, content };
                }
                return {
                    role: m.role as 'user' | 'assistant',
                    content: m.content,
                };
            });
    }

    // finishReasonマッピング
    function mapFinishReason(
        stopReason: string | null
    ): FinishReason {
        switch (stopReason) {
            case 'end_turn':
                return 'stop';
            case 'tool_use':
                return 'tool_calls';
            case 'max_tokens':
                return 'length';
            default:
                return 'stop';
        }
    }

    return (modelId: string): LanguageModel => ({
        async doGenerate(params: GenerateParams): Promise<GenerateTextResult> {
            // systemメッセージを分離
            const systemMessages = params.messages.filter(
                (m) => m.role === 'system'
            );
            const system = systemMessages.map((m) => ({
                type: 'text' as const,
                text: m.content,
            }));

            // ツール定義をAnthropic形式に変換
            const tools = params.tools?.map((tool) => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.parameters as Anthropic.Tool.InputSchema,
            }));

            try {
                const response = await client.messages.create(
                    {
                        model: modelId,
                        system,
                        messages: convertMessages(params.messages) as Anthropic.MessageParam[],
                        max_tokens: params.maxTokens ?? 4096,
                        temperature: params.temperature,
                        ...(tools && tools.length > 0 && { tools }),
                    },
                    { signal: params.signal }
                );

                // レスポンスからテキストとツール呼び出しを抽出
                const textBlocks = response.content.filter(
                    (b) => b.type === 'text'
                );
                const text = textBlocks.map((b: any) => b.text).join('');

                const toolUseBlocks = response.content.filter(
                    (b) => b.type === 'tool_use'
                );
                const toolCalls: ToolCall[] | undefined =
                    toolUseBlocks.length > 0
                        ? toolUseBlocks.map((b: any) => ({
                              toolCallId: b.id,
                              name: b.name,
                              args: b.input,
                          }))
                        : undefined;

                return {
                    text,
                    finishReason: mapFinishReason(response.stop_reason),
                    toolCalls,
                    usage: {
                        promptTokens: response.usage.input_tokens,
                        completionTokens: response.usage.output_tokens,
                        totalTokens:
                            response.usage.input_tokens +
                            response.usage.output_tokens,
                    },
                };
            } catch (error) {
                if (error instanceof Anthropic.APIError) {
                    throw new LLMApiError(
                        error.status ?? 500,
                        'anthropic',
                        (error.error as any)?.type,
                        error.message,
                        error
                    );
                }
                throw error;
            }
        },
        // Appendix Aで実装
        async *doStream(params: GenerateParams): AsyncIterable<StreamChunk> {
            const systemMessages = params.messages.filter(
                (m) => m.role === 'system'
            );
            const system = systemMessages.map((m) => ({
                type: 'text' as const,
                text: m.content,
            }));

            const tools = params.tools?.map((tool) => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.parameters as Anthropic.Tool.InputSchema,
            }));

            try {
                const stream = await client.messages.create(
                    {
                        model: modelId,
                        max_tokens: params.maxTokens ?? 4096,
                        system,
                        messages: convertMessages(params.messages) as Anthropic.MessageParam[],
                        temperature: params.temperature,
                        stream: true,
                        ...(tools && tools.length > 0 && { tools }),
                    },
                    { signal: params.signal }
                );

                const toolCalls: Record<string, ToolCall> = {};
                const partialJsonBuffers: Record<string, string> = {};
                const indexToId: Record<number, string> = {};
                let finishReason: StreamChunk['finishReason'];
                let usage: StreamChunk['usage'];

                for await (const event of stream) {
                    switch (event.type) {
                        case 'content_block_start':
                            if (event.content_block?.type === 'tool_use') {
                                const id = event.content_block.id;
                                indexToId[event.index] = id;
                                toolCalls[id] = {
                                    toolCallId: id,
                                    name: event.content_block.name,
                                    args: {},
                                };
                                partialJsonBuffers[id] = '';
                            }
                            break;

                        case 'content_block_delta':
                            if (event.delta?.type === 'text_delta') {
                                yield { kind: 'delta', text: event.delta.text };
                            }
                            if (event.delta?.type === 'input_json_delta') {
                                const id = indexToId[event.index];
                                const toolCall = id ? toolCalls[id] : undefined;
                                if (id && toolCall) {
                                    const buffer =
                                        (partialJsonBuffers[id] ?? '') +
                                        event.delta.partial_json;
                                    partialJsonBuffers[id] = buffer;
                                    try {
                                        toolCall.args = JSON.parse(buffer);
                                    } catch {
                                        // JSONが不完全な場合は次のデルタを待つ
                                    }
                                }
                            }
                            break;

                        case 'message_delta': {
                            if (event.delta?.stop_reason) {
                                finishReason = mapFinishReason(
                                    event.delta.stop_reason
                                );
                            }
                            if (event.usage) {
                                usage = {
                                    promptTokens:
                                        event.usage.input_tokens ?? undefined,
                                    completionTokens: event.usage.output_tokens,
                                    totalTokens:
                                        (event.usage.input_tokens || 0) +
                                        (event.usage.output_tokens || 0),
                                };
                            }
                            break;
                        }

                        case 'message_stop': {
                            const toolCallList = Object.values(toolCalls);
                            yield {
                                kind: 'done',
                                finishReason,
                                usage,
                                toolCalls:
                                    toolCallList.length > 0
                                        ? toolCallList
                                        : undefined,
                            };
                            return;
                        }
                        default:
                            break;
                    }
                }
            } catch (error) {
                if (error instanceof Anthropic.APIError) {
                    throw new LLMApiError(
                        error.status ?? 500,
                        'anthropic',
                        (error.error as any)?.type,
                        error.message,
                        error
                    );
                }
                throw error;
            }
        },
    });
}

/*
// ==========================================
// 実用上のAPI不整合エラー（400）対策の変更例
// ==========================================
// 第6章「6.5 manageContextメソッドの実装」で導入される履歴圧縮（会話履歴の自動削減）によって
// 過去のメッセージがスライス・削減された際、ツール呼び出し（tool_use）と実行結果（tool_result）の
// 親子関係（対となるペア）が壊れることで、Anthropic API が 400 Bad Request エラーを返すようになる実用上の問題があります。
// 
// これを防ぐため、convertMessages を以下のように書き換え、クリーンアップ関数（cleanMessages）を適用してください。

// 変更例 (convertMessages 内で cleanMessages を適用する):
//
//  function convertMessages(messages: Message[]) {
// -    return messages
// +    const cleaned = cleanMessages(messages);
// +    return cleaned
//          .filter((m) => m.role !== 'system')
//          .map((m) => {
//              // (中身は変更なし)
//          });
//  }

function cleanMessages(messages: Message[]): Message[] {
    const existingToolCallIds = new Set(
        messages
            .filter(m => m.role === 'tool')
            .map(m => (m as any).toolCallId)
    );

    const finalMessages: Message[] = [];
    for (const msg of messages) {
        if (msg.role === 'tool') {
            let foundAssistant = false;
            for (let j = finalMessages.length - 1; j >= 0; j--) {
                const prev = finalMessages[j];
                if (prev && prev.role === 'assistant' && 'toolCalls' in prev && prev.toolCalls) {
                    if (prev.toolCalls.some((tc: any) => tc.toolCallId === msg.toolCallId)) {
                        foundAssistant = true;
                        break;
                    }
                }
            }
            if (foundAssistant) {
                finalMessages.push(msg);
            }
        } else if (msg.role === 'assistant' && 'toolCalls' in msg && msg.toolCalls) {
            const validToolCalls = msg.toolCalls.filter((tc: any) => existingToolCallIds.has(tc.toolCallId));
            if (validToolCalls.length > 0) {
                finalMessages.push({
                    role: 'assistant',
                    content: msg.content,
                    toolCalls: validToolCalls
                } as Message);
            } else {
                finalMessages.push({
                    role: 'assistant',
                    content: msg.content
                } as Message);
            }
        } else {
            finalMessages.push(msg);
        }
    }
    return finalMessages;
}
*/
