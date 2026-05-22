import type { GenerateParams, GenerateTextResult, LanguageModel } from '../types';

// generateText用のパラメータ型（GenerateParamsにmodelを追加）
type GenerateTextParams = GenerateParams & {
    model: LanguageModel;
};

export async function generateText(
    params: GenerateTextParams
): Promise<GenerateTextResult> {
    return await params.model.doGenerate({
        messages: params.messages,
        tools: params.tools,
        temperature: params.temperature,
        maxTokens: params.maxTokens,
        signal: params.signal,
    });
}
