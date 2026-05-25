import { afterEach, describe, expect, test } from 'bun:test';
import { createModelFromEnv } from './modelFactory';

const savedEnv = {
    LLM_PROVIDER: process.env.LLM_PROVIDER,
    LLM_MODEL: process.env.LLM_MODEL,
    LLM_API_KEY: process.env.LLM_API_KEY,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
};

function restoreEnv() {
    for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
}

describe('createModelFromEnv', () => {
    afterEach(() => {
        restoreEnv();
    });

    test('maps LLM_API_KEY to GEMINI_API_KEY for Google provider', () => {
        const env = process.env as Record<string, string | undefined>;
        env.LLM_PROVIDER = 'google';
        env.LLM_MODEL = 'gemini-test';
        env.LLM_API_KEY = 'test-google-key';
        delete env.GOOGLE_API_KEY;
        delete env.GEMINI_API_KEY;

        createModelFromEnv();

        expect(process.env.GOOGLE_API_KEY).toBeUndefined();
        expect(process.env.GEMINI_API_KEY).toBe('test-google-key');
    });
});
