import { Agent } from '../src/core/agent';
import { createOpenAI } from '../src/providers/openai';
import { readFile } from '../src/tools/readFile';
import { writeFile } from '../src/tools/writeFile';
import { editFile } from '../src/tools/editFile';
import { execCommand } from '../src/tools/execCommand';

// モデルインスタンスを作成
const openai = createOpenAI();
const model = openai('gpt-5');

export const codingAgent = new Agent({
  name: 'nano-code',
  instructions: 'あなたはコーディングエージェントです。慎重に作業してください。',
  model,
  tools: {
    readFile,
    writeFile,
    editFile,
    execCommand,
  },
  maxSteps: 20,
  verbose: true,
});

// 実行（直接実行された場合のみ）
if (import.meta.main) {
  const result = await codingAgent.generate(
    'tests/example.test.ts のバグを修正して'
  );
  console.log(result.text);
}
