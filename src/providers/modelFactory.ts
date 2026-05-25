import { createOpenAI } from './openai';
import { createOpenAIResponses } from './openai-responses';
import { createAnthropic } from './anthropic';
import { createGoogle } from './google';
import type { LanguageModel } from '../types';

export function createModelFromEnv(options?: { useResponses?: boolean }): LanguageModel {
    // 1. 環境変数を読み取る
    const provider = process.env.LLM_PROVIDER;
    const modelName = process.env.LLM_MODEL;
    const apiKey = process.env.LLM_API_KEY;
    // CLI の --responses オプションから OpenAI Responses API を切り替える。
    const useResponses = options?.useResponses ?? process.env.USE_RESPONSES_API === 'true';

    // 2. 必須の環境変数が未設定ならエラー
    if (!provider) {
        throw new Error('LLM_PROVIDER 環境変数が設定されていません');
    }
    if (!modelName) {
        throw new Error('LLM_MODEL 環境変数が設定されていません');
    }

    // 3. プロバイダーに応じてモデルを生成
    // LLM_API_KEYが設定されている場合、プロバイダー固有の環境変数に設定
    switch (provider.toLowerCase()) {
        case 'openai': {
            if (apiKey && !process.env.OPENAI_API_KEY) {
                process.env.OPENAI_API_KEY = apiKey;
            }
            // 付録 B: OpenAI Responses API への対応
            if (useResponses) {
                const openai = createOpenAIResponses();
                return openai(modelName);
            }
            const openai = createOpenAI();
            return openai(modelName);
        }
        case 'anthropic': {
            if (apiKey && !process.env.ANTHROPIC_API_KEY) {
                process.env.ANTHROPIC_API_KEY = apiKey;
            }
            const anthropic = createAnthropic();
            return anthropic(modelName);
        }
        case 'google': {
            // @google/genai SDK は GEMINI_API_KEY を自動参照するため、LLM_API_KEY もこちらへ反映する
            if (apiKey && !process.env.GEMINI_API_KEY) {
                process.env.GEMINI_API_KEY = apiKey;
            }
            const google = createGoogle();
            return google(modelName);
        }
        default:
            throw new Error(`未対応のプロバイダー: ${provider}. 対応プロバイダー: openai, anthropic, google`);
    }
}
