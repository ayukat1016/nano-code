import OpenAI from 'openai';
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

export function createOpenAI(config?: {
    apiKey?: string;
    baseURL?: string;
    maxRetries?: number;
}): Provider {
    // SDK初期化（認証はSDKが担当）
    const client = new OpenAI({
        apiKey: config?.apiKey, // 省略時は環境変数OPENAI_API_KEYを自動参照
        baseURL: config?.baseURL,
        maxRetries: config?.maxRetries ?? 0, // nano-code-coreがリトライを制御
    });

    // Nano Code Message → OpenAI形式へ変換
    function convertMessages(messages: Message[]) {
        // 履歴圧縮後も、ツール呼び出しと結果の対応が壊れないように補正する。
        const cleaned = cleanMessages(messages);
        return cleaned.map((m) => {
            if (m.role === 'tool') {
                return {
                    role: 'tool' as const,
                    tool_call_id: m.toolCallId,
                    content: m.content,
                };
            }
            if (m.role === 'assistant' && m.toolCalls) {
                return {
                    role: 'assistant' as const,
                    content: m.content,
                    tool_calls: m.toolCalls.map((tc) => ({
                        id: tc.toolCallId,
                        type: 'function' as const,
                        function: { name: tc.name, arguments: JSON.stringify(tc.args) },
                    })),
                };
            }
            return { role: m.role, content: m.content };
        });
    }

    // finishReasonマッピング
    function mapFinishReason(
        reason: string | null
    ): FinishReason {
        switch (reason) {
            case 'stop':
                return 'stop';
            case 'length':
                return 'length';
            case 'content_filter':
                return 'content_filter';
            case 'tool_calls':
                return 'tool_calls';
            default:
                return 'stop';
        }
    }

    // OpenAI API が返すツール引数を安全にパースし、壊れた JSON では空オブジェクトにフォールバックする。
    function parseToolCallArgs(argsText: string | undefined): Record<string, unknown> {
        if (!argsText) return {};
        try {
            return JSON.parse(argsText);
        } catch {
            // 不正な JSON では SyntaxError を伝播させない。
            return {};
        }
    }

    return (modelId: string): LanguageModel => ({
        async doGenerate(params: GenerateParams): Promise<GenerateTextResult> {
            // ツール定義をOpenAI形式に変換
            const tools = params.tools?.map((tool) => ({
                type: 'function' as const,
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                },
            }));

            try {
                // 1. SDKで生成を実行
                const completion = await client.chat.completions.create(
                    {
                        model: modelId,
                        messages: convertMessages(params.messages) as OpenAI.ChatCompletionMessageParam[],
                        temperature: params.temperature,
                        max_completion_tokens: params.maxTokens,
                        ...(tools && tools.length > 0 && { tools }),
                    },
                    { signal: params.signal }
                );

                // 3. SDKの応答を統一型に変換
                const choice = completion.choices[0];
                if (!choice) {
                    throw new LLMApiError(
                        500,
                        'openai',
                        undefined,
                        'APIからの応答がありません'
                    );
                }
                const message = choice.message;

                const toolCalls: ToolCall[] | undefined = message.tool_calls?.map(
                    (tc: any) => ({
                        toolCallId: tc.id,
                        name: tc.function.name,
                        args: parseToolCallArgs(tc.function.arguments),
                    })
                );

                return {
                    text: message.content ?? '',
                    finishReason: mapFinishReason(choice.finish_reason),
                    toolCalls,
                    usage: completion.usage
                        ? {
                              promptTokens: completion.usage.prompt_tokens,
                              completionTokens: completion.usage.completion_tokens,
                              totalTokens: completion.usage.total_tokens,
                          }
                        : undefined,
                };
            } catch (error) {
                // 2. SDKの例外をLLMApiErrorに変換
                if (error instanceof OpenAI.APIError) {
                    throw new LLMApiError(
                        error.status ?? 500,
                        'openai',
                        error.code ?? undefined,
                        error.message,
                        error
                    );
                }
                throw error;
            }
        },
        // Appendix Aで実装
        async *doStream(params: GenerateParams): AsyncIterable<StreamChunk> {
            const tools = params.tools?.map((tool) => ({
                type: 'function' as const,
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                },
            }));

            try {
                const stream = await client.chat.completions.create(
                    {
                        model: modelId,
                        messages: convertMessages(params.messages) as OpenAI.ChatCompletionMessageParam[],
                        temperature: params.temperature,
                        ...(params.maxTokens !== undefined && {
                            max_completion_tokens: params.maxTokens,
                        }),
                        stream: true,
                        stream_options: { include_usage: true },
                        ...(tools && tools.length > 0 && { tools }),
                    },
                    { signal: params.signal }
                );

                const toolCallBuffer: Record<
                    string,
                    { id: string; name: string; argsText: string }
                > = {};
                let toolCallIndex = 0;
                let finishReason: StreamChunk['finishReason'];
                let usage: StreamChunk['usage'];

                for await (const chunk of stream) {
                    const choice = chunk.choices?.[0];

                    if (choice?.delta?.content) {
                        yield { kind: 'delta', text: choice.delta.content };
                    }

                    if (choice?.delta?.tool_calls) {
                        for (const tc of choice.delta.tool_calls) {
                            const key = tc.id || String(tc.index ?? toolCallIndex++);
                            const existing = toolCallBuffer[key] || {
                                id: tc.id || key,
                                name: '',
                                argsText: '',
                            };

                            if (tc.function?.name) existing.name = tc.function.name;
                            if (tc.function?.arguments) {
                                existing.argsText += tc.function.arguments;
                            }

                            toolCallBuffer[key] = existing;
                        }
                    }

                    if (choice?.finish_reason) {
                        finishReason = mapFinishReason(choice.finish_reason);
                    }

                    if (chunk.usage) {
                        usage = {
                            promptTokens: chunk.usage.prompt_tokens,
                            completionTokens: chunk.usage.completion_tokens,
                            totalTokens: chunk.usage.total_tokens,
                        };
                    }
                }

                const toolCalls = Object.values(toolCallBuffer).map((tc) => ({
                    toolCallId: tc.id,
                    name: tc.name,
                    args: parseToolCallArgs(tc.argsText),
                }));

                yield {
                    kind: 'done',
                    finishReason,
                    usage,
                    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
                };
            } catch (error) {
                if (error instanceof OpenAI.APIError) {
                    throw new LLMApiError(
                        error.status ?? 500,
                        'openai',
                        error.code ?? undefined,
                        error.message,
                        error
                    );
                }
                throw error;
            }
        },
    });
}

function cleanMessages(messages: Message[]): Message[] {
    const existingToolCallIds = new Set(
        messages
            .filter((m) => m.role === 'tool')
            .map((m) => (m as any).toolCallId)
    );

    const finalMessages: Message[] = [];
    for (const msg of messages) {
        if (msg.role === 'tool') {
            let foundAssistant = false;
            for (let j = finalMessages.length - 1; j >= 0; j--) {
                const prev = finalMessages[j];
                if (
                    prev &&
                    prev.role === 'assistant' &&
                    'toolCalls' in prev &&
                    prev.toolCalls
                ) {
                    if (
                        prev.toolCalls.some(
                            (tc: any) => tc.toolCallId === msg.toolCallId
                        )
                    ) {
                        foundAssistant = true;
                        break;
                    }
                }
            }
            if (foundAssistant) {
                finalMessages.push(msg);
            }
        } else if (
            msg.role === 'assistant' &&
            'toolCalls' in msg &&
            msg.toolCalls
        ) {
            const validToolCalls = msg.toolCalls.filter((tc: any) =>
                existingToolCallIds.has(tc.toolCallId)
            );
            if (validToolCalls.length > 0) {
                finalMessages.push({
                    role: 'assistant',
                    content: msg.content,
                    toolCalls: validToolCalls,
                } as Message);
            } else {
                finalMessages.push({
                    role: 'assistant',
                    content: msg.content,
                } as Message);
            }
        } else {
            finalMessages.push(msg);
        }
    }

    // system メッセージを除いた結果が空になるのを防ぐ
    const nonSystemMessages = finalMessages.filter(m => m.role !== 'system');
    if (nonSystemMessages.length === 0) {
        finalMessages.push({
            role: 'user',
            content: '続けてください。'
        });
    }

    return finalMessages;
}
