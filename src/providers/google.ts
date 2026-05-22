import { GoogleGenAI } from '@google/genai';
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

export function createGoogle(config?: { apiKey?: string }): Provider {
    const client = new GoogleGenAI({
        apiKey: config?.apiKey, // 省略時は環境変数GEMINI_API_KEYを自動参照
    });

    // メッセージをGoogle形式に変換
    function convertMessages(messages: Message[]) {
        return messages
            .filter((m) => m.role !== 'system')
            .map((m) => {
                // ツール結果はuserロール + functionResponse
                if (m.role === 'tool') {
                    return {
                        role: 'user' as const,
                        parts: [
                            {
                                functionResponse: {
                                    name: m.name,
                                    response: { result: m.content },
                                },
                            },
                        ],
                    };
                }
                // assistantのツール呼び出し
                if (m.role === 'assistant' && m.toolCalls) {
                    const parts: any[] = [];
                    if (m.content) {
                        parts.push({ text: m.content });
                    }
                    for (const tc of m.toolCalls) {
                        parts.push({
                            functionCall: { name: tc.name, args: tc.args },
                        });
                    }
                    return { role: 'model' as const, parts };
                }
                // 通常のメッセージ
                const role = m.role === 'assistant' ? 'model' : 'user';
                return {
                    role: role as 'user' | 'model',
                    parts: [{ text: m.content }],
                };
            });
    }

    // finishReasonマッピング
    function mapFinishReason(
        reason: string | undefined,
        hasFunctionCall: boolean
    ): FinishReason {
        if (hasFunctionCall) return 'tool_calls';
        switch (reason?.toUpperCase()) {
            case 'STOP':
                return 'stop';
            case 'MAX_TOKENS':
                return 'length';
            case 'SAFETY':
                return 'content_filter';
            default:
                return 'stop';
        }
    }

    return (modelId: string): LanguageModel => ({
        async doGenerate(params: GenerateParams): Promise<GenerateTextResult> {
            // systemメッセージを抽出
            const systemMessages = params.messages.filter(
                (m) => m.role === 'system'
            );
            const systemInstruction = systemMessages
                .map((m) => m.content)
                .join('\n');

            // ツール定義をGoogle形式に変換
            const tools = params.tools?.length
                ? [
                      {
                          functionDeclarations: params.tools.map((tool) => ({
                              name: tool.name,
                              description: tool.description,
                              parameters: tool.parameters,
                          })),
                      },
                  ]
                : undefined;

            try {
                const response = await client.models.generateContent({
                    model: modelId,
                    contents: convertMessages(params.messages),
                    config: {
                        systemInstruction,
                        temperature: params.temperature,
                        maxOutputTokens: params.maxTokens,
                        ...(tools && { tools }),
                    },
                });

                const candidate = response.candidates?.[0];
                const parts = candidate?.content?.parts ?? [];

                // partsからテキストとfunctionCallを抽出
                const textParts = parts.filter((p: any) => p.text);
                const text = textParts.map((p: any) => p.text).join('');

                const functionCallParts = parts.filter(
                    (p: any) => p.functionCall
                );
                const toolCalls: ToolCall[] | undefined =
                    functionCallParts.length > 0
                        ? functionCallParts.map((p: any, i: number) => ({
                              toolCallId: `call_${i}`, // Gemini APIはIDを返さないため生成
                              name: p.functionCall.name,
                              args: p.functionCall.args,
                          }))
                        : undefined;

                return {
                    text,
                    finishReason: mapFinishReason(
                        candidate?.finishReason,
                        functionCallParts.length > 0
                    ),
                    toolCalls,
                    usage: {
                        promptTokens: response.usageMetadata?.promptTokenCount,
                        completionTokens:
                            response.usageMetadata?.candidatesTokenCount,
                        totalTokens: response.usageMetadata?.totalTokenCount,
                    },
                };
            } catch (error: any) {
                throw new LLMApiError(
                    error.status ?? 500,
                    'google',
                    error.code,
                    error.message,
                    error
                );
            }
        },

        // Appendix Aで実装
        async *doStream(params: GenerateParams): AsyncIterable<StreamChunk> {
            const systemMessages = params.messages.filter(
                (m) => m.role === 'system'
            );
            const systemInstruction = systemMessages
                .map((m) => m.content)
                .join('\n');

            const tools = params.tools?.length
                ? [
                      {
                          functionDeclarations: params.tools.map((tool) => ({
                              name: tool.name,
                              description: tool.description,
                              parameters: tool.parameters,
                          })),
                      },
                  ]
                : undefined;

            try {
                const stream = await client.models.generateContentStream({
                    model: modelId,
                    contents: convertMessages(params.messages),
                    config: {
                        systemInstruction,
                        temperature: params.temperature,
                        maxOutputTokens: params.maxTokens,
                        ...(tools && { tools }),
                    },
                });

                const toolCalls: Record<string, ToolCall> = {};
                let finishReason: StreamChunk['finishReason'];
                let usage: StreamChunk['usage'];

                for await (const chunk of stream) {
                    const candidate = chunk.candidates?.[0];
                    const parts: any[] = candidate?.content?.parts ?? [];

                    for (const part of parts) {
                        if (part.text) {
                            yield { kind: 'delta', text: part.text };
                        }

                        if (part.functionCall) {
                            // 書籍の記述（付録A）に合わせ、関数名をそのままIDとして使用
                            // ※非ストリーミング（doGenerate）の連番によるID生成とは異なる点に注意
                            const id = part.functionCall.name;
                            toolCalls[id] = {
                                toolCallId: id,
                                name: part.functionCall.name,
                                args: part.functionCall.args || {},
                            };
                        }
                    }

                    if (candidate?.finishReason) {
                        finishReason = mapFinishReason(
                            candidate.finishReason,
                            Object.keys(toolCalls).length > 0
                        );
                    }

                    if (chunk.usageMetadata) {
                        const promptTokens = chunk.usageMetadata.promptTokenCount;
                        const completionTokens =
                            chunk.usageMetadata.candidatesTokenCount;
                        usage = {
                            promptTokens,
                            completionTokens,
                            totalTokens:
                                (promptTokens || 0) + (completionTokens || 0),
                        };
                    }
                }

                const toolCallList = Object.values(toolCalls);
                yield {
                    kind: 'done',
                    finishReason,
                    usage,
                    toolCalls: toolCallList.length > 0 ? toolCallList : undefined,
                };
            } catch (error: any) {
                throw new LLMApiError(
                    error.status ?? 500,
                    'google',
                    error.code,
                    error.message,
                    error
                );
            }
        },
    });
}
