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
                              // 引数なしの関数呼び出し時に args が null/undefined となる場合があるため
                              // 配布コードでは書籍のスニペットから ?? {} を追加している
                              args: p.functionCall.args ?? {},
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
                let toolCallIndex = 0;
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
                            // 書籍付録Aのスニペットでは関数名をそのままIDとして使用しているが、
                            // 同一関数の複数回呼び出し時に後の呼び出しが前を上書きしてしまう問題があるため、
                            // 配布コードでは doGenerate と同様に連番式 ID（call_0, call_1, ...）を使用する。
                            const id = `call_${toolCallIndex++}`;
                            toolCalls[id] = {
                                toolCallId: id,
                                name: part.functionCall.name,
                                // args が null/undefined の場合に備えて ?? {} を適用
                                args: part.functionCall.args ?? {},
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

/*
// ==========================================
// 実用上のAPI不整合エラー（400）対策の変更例
// ==========================================
// 第6章「6.5 manageContextメソッドの実装」で導入される履歴圧縮（会話履歴の自動削減）によって
// 過去のメッセージがスライス・削減された際、ツール呼び出し（functionCall）と実行結果（functionResponse）の
// 親子関係（対となるペア）が壊れることで、Google Gen AI API が 400 Bad Request エラーを返すようになる実用上の問題があります。
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

