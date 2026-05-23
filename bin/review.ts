import { parseArgs } from 'util';
import { Agent } from '../src/core/agent';
import { loadInstructions } from '../src/core/prompt';
import { createModelFromEnv } from '../src/providers/modelFactory';

import { parseCommand } from '../src/tools/execCommand';
import { mkdirSync, existsSync, writeFileSync, unlinkSync } from 'fs';
import * as fsPromises from 'fs/promises';
import { join, resolve, sep } from 'path';
import { config } from '../src/config';
import { spawn } from 'child_process';
import type { Tool } from '../src/types';

// 機密情報をマスクする（ログ出力用）
function maskSecret(value: string | undefined): string {
    if (!value) return '(未設定)';
    if (value.length <= 8) return '***';
    return value.slice(0, 4) + '***' + value.slice(-4);
}

const REPO_ROOT = process.cwd();
const WORKSPACE_ROOT = join(REPO_ROOT, 'workspace');
const MAX_FILE_SIZE = 100 * 1024;
const ALLOWED_COMMANDS = ['bun', 'ls', 'pwd', 'mkdir', 'git', 'gh'];
const MAX_OUTPUT_LENGTH = 2000;

// PRレビュー用にリポジトリルート (REPO_ROOT) のファイルを読み込めるようにした readFile ツール
const reviewReadFile: Tool = {
    name: 'readFile',
    description: 'リポジトリ内の指定されたファイルのパスから内容を読み込む。100KB以下のファイルのみ読み込めます。',
    needsApproval: false,
    parameters: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: '読み込むファイルの相対パス（例: "src/tools/github.ts"）',
            },
        },
        required: ['path'],
    },
    execute: async (args: Record<string, unknown>) => {
        const { path } = args as { path: string };
        // エージェントが "workspace/" または "./workspace/" から始まるパスでアクセスしてきた場合、
        // 実際のファイルがリポジトリルートに存在することを想定してパスをクリーンアップ
        let cleanPath = path;
        if (cleanPath.startsWith('workspace/')) {
            cleanPath = cleanPath.slice(10);
        } else if (cleanPath.startsWith('./workspace/')) {
            cleanPath = cleanPath.slice(12);
        } else if (cleanPath.startsWith('../')) {
            // エージェントが ../ からアクセスしようとした場合
            cleanPath = cleanPath.slice(3);
        }
        
        const absolutePath = resolve(REPO_ROOT, cleanPath);
        const allowedPrefix = REPO_ROOT + sep;

        if (!absolutePath.startsWith(allowedPrefix) && absolutePath !== REPO_ROOT) {
            throw new Error(`アクセス拒否: ${path} はリポジトリの外部です`);
        }

        try {
            // シンボリックリンクを解決して実パスを検証（セキュリティ対策）
            const realPath = await fsPromises.realpath(absolutePath);
            if (!realPath.startsWith(allowedPrefix) && realPath !== REPO_ROOT) {
                throw new Error(`アクセス拒否: ${path} はシンボリックリンク経由でリポジトリ外を参照しています`);
            }

            const stat = await fsPromises.stat(realPath);
            if (!stat.isFile()) {
                throw new Error(`通常ファイルではありません: ${path}`);
            }
            if (stat.size > MAX_FILE_SIZE) {
                throw new Error(`ファイルが大きすぎます: ${path}`);
            }
            return await fsPromises.readFile(realPath, 'utf-8');
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                throw new Error(`ファイルが見つかりません: ${path}`);
            }
            throw error;
        }
    }
};

// PRレビュー用にリポジトリルート (REPO_ROOT) を基準にコマンドを実行し、パスチェックも緩和した execCommand ツール
const reviewExecCommand: Tool = {
    name: 'execCommand',
    description: 'リポジトリルート内で許可された汎用コマンドを実行する。利用可能：bun、ls、pwd、mkdir、git、gh。',
    needsApproval: true,
    parameters: {
        type: 'object',
        properties: {
            command: {
                type: 'string',
                description: '実行するコマンド（例: "bun test", "git diff"）',
            },
        },
        required: ['command'],
    },
    execute: async (args: Record<string, unknown>) => {
        const { command } = args as { command: string };
        // $ は正規表現や引数の文字列（ドル記号など）で頻出するため除外（shell: false で実行されるため安全です）
        const dangerousChars = /[;&`]/;
        if (dangerousChars.test(command)) {
            throw new Error('セキュリティ上の理由により、シェルメタ文字を含むコマンドは実行できません');
        }

        const parts = parseCommand(command);
        const commandName = parts[0] || '';
        const commandArgs = parts.slice(1);

        if (!ALLOWED_COMMANDS.includes(commandName)) {
            throw new Error(`コマンド ${commandName} は許可されていません`);
        }

        // 引数のパス制限を REPO_ROOT 基準にする
        for (const arg of commandArgs) {
            if (arg.startsWith('/') || arg.startsWith('.') || arg.includes('/') || arg.includes('\\')) {
                let cleanArg = arg;
                if (cleanArg.startsWith('workspace/')) {
                    cleanArg = cleanArg.slice(10);
                } else if (cleanArg.startsWith('./workspace/')) {
                    cleanArg = cleanArg.slice(12);
                } else if (cleanArg.startsWith('../')) {
                    cleanArg = cleanArg.slice(3);
                }
                const resolvedPath = resolve(REPO_ROOT, cleanArg);
                const allowedPrefix = REPO_ROOT + sep;
                if (!resolvedPath.startsWith(allowedPrefix) && resolvedPath !== REPO_ROOT) {
                    throw new Error(`アクセス拒否: ${arg} はリポジトリ外です`);
                }
            }
        }

        return new Promise((resolvePromise, reject) => {
            const child = spawn(commandName, commandArgs, {
                cwd: REPO_ROOT, // リポジトリルートで実行
                timeout: 30000,
                shell: false,
            });

            let stdout = '';
            let stderr = '';
            let stdoutTruncated = false;
            let stderrTruncated = false;

            child.stdout.on('data', (data: Buffer) => {
                if (stdout.length < MAX_OUTPUT_LENGTH) {
                    stdout += data.toString();
                    if (stdout.length >= MAX_OUTPUT_LENGTH) {
                        stdoutTruncated = true;
                    }
                }
            });

            child.stderr.on('data', (data: Buffer) => {
                if (stderr.length < MAX_OUTPUT_LENGTH) {
                    stderr += data.toString();
                    if (stderr.length >= MAX_OUTPUT_LENGTH) {
                        stderrTruncated = true;
                    }
                }
            });

            child.on('close', (code: number | null) => {
                if (stdoutTruncated) {
                    stdout = stdout.slice(0, MAX_OUTPUT_LENGTH) + '\n... (出力が長いため省略されました)';
                }
                if (stderrTruncated) {
                    stderr = stderr.slice(0, MAX_OUTPUT_LENGTH) + '\n... (出力が長いため省略されました)';
                }

                if (code === 0) {
                    resolvePromise(stdout + (stderr ? `\n(stderr: ${stderr.trim()})` : ''));
                } else {
                    reject(new Error(`コマンドが異常終了しました (exit code: ${code})\n${stderr}`));
                }
            });

            child.on('error', (error: Error) => {
                reject(new Error(`コマンド実行エラー: ${error.message}`));
            });
        });
    }
};

// PRレビュー用の一時ファイル書き込み（WORKSPACE_ROOT に保存）
function reviewWriteTempFile(content: string, prefix: string): string {
    if (!existsSync(WORKSPACE_ROOT)) {
        mkdirSync(WORKSPACE_ROOT, { recursive: true });
    }
    const tempPath = join(WORKSPACE_ROOT, `.${prefix}-${Date.now()}.txt`);
    writeFileSync(tempPath, content, 'utf-8');
    return tempPath;
}

// PRレビュー用: gh pr diff を REPO_ROOT で実行（github.ts の共通版は cwd: WORKSPACE_ROOT のため使わない）
const reviewGetPullRequestDiff: Tool = {
    name: 'getPullRequestDiff',
    description: 'GitHub CLI を使って指定されたプルリクエストの差分を取得する',
    needsApproval: true,
    parameters: {
        type: 'object',
        properties: {
            prNumber: {
                type: 'number',
                description: '差分を取得するプルリクエストの番号'
            }
        },
        required: ['prNumber']
    },
    execute: async (args: Record<string, unknown>) => {
        const { prNumber } = args as { prNumber: number };
        if (!Number.isInteger(prNumber) || prNumber <= 0) {
            throw new Error('prNumber は正の整数で指定してください');
        }
        return new Promise<string>((resolvePromise, reject) => {
            const child = spawn('gh', ['pr', 'diff', String(prNumber)], {
                cwd: REPO_ROOT,
                timeout: 60000,
                shell: false,
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data: Buffer) => {
                stdout += data.toString();
            });

            child.stderr.on('data', (data: Buffer) => {
                stderr += data.toString();
            });

            child.on('close', (code: number | null) => {
                if (code === 0) {
                    resolvePromise(stdout + (stderr ? `\n(stderr: ${stderr.trim()})` : ''));
                } else {
                    reject(new Error(`gh pr diff が異常終了しました (exit code: ${code})\n${stderr}`));
                }
            });

            child.on('error', (error: Error) => {
                reject(new Error(`コマンド実行エラー: ${error.message}`));
            });
        });
    }
};

// PRレビュー用: gh pr review を REPO_ROOT で実行
const reviewCreatePullRequestReview: Tool = {
    name: 'createPullRequestReview',
    description: 'GitHub CLI を使って指定されたプルリクエストにレビューコメント（全体コメント）を投稿する',
    needsApproval: true,
    parameters: {
        type: 'object',
        properties: {
            prNumber: {
                type: 'number',
                description: 'レビューを投稿するプルリクエストの番号'
            },
            body: {
                type: 'string',
                description: 'レビューコメントの本文'
            }
        },
        required: ['prNumber', 'body']
    },
    execute: async (args: Record<string, unknown>) => {
        const { prNumber, body } = args as { prNumber: number, body: string };
        if (!Number.isInteger(prNumber) || prNumber <= 0) {
            throw new Error('prNumber は正の整数で指定してください');
        }
        const bodyFile = reviewWriteTempFile(body, 'pr-review-body');
        return new Promise<string>((resolvePromise, reject) => {
            const child = spawn('gh', ['pr', 'review', String(prNumber), '--comment', '--body-file', bodyFile], {
                cwd: REPO_ROOT,
                timeout: 30000,
                shell: false,
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data: Buffer) => {
                stdout += data.toString();
            });

            child.stderr.on('data', (data: Buffer) => {
                stderr += data.toString();
            });

            child.on('close', (code: number | null) => {
                try { unlinkSync(bodyFile); } catch { /* ignore */ }
                if (code === 0) {
                    resolvePromise('PRレビューを投稿しました');
                } else {
                    reject(new Error(`gh pr review が異常終了しました (exit code: ${code})\n${stderr}`));
                }
            });

            child.on('error', (error: Error) => {
                try { unlinkSync(bodyFile); } catch { /* ignore */ }
                reject(new Error(`コマンド実行エラー: ${error.message}`));
            });
        });
    }
};

async function main() {
    const { values } = parseArgs({
        args: process.argv.slice(2),
        options: {
            'yolo': { type: 'boolean', default: false },
            'sandbox': { type: 'boolean', default: false },
        },
    });

    const yoloMode = values['yolo'] ?? false;
    config.sandbox = values['sandbox'] ?? false;

    // 1. 環境変数 PULL_REQUEST_NUMBER からPR番号を取得
    const prNumberStr = process.env.PULL_REQUEST_NUMBER;
    if (!prNumberStr) {
        console.error('エラー: 環境変数 PULL_REQUEST_NUMBER を指定してください');
        process.exit(1);
    }
    const prNumber = parseInt(prNumberStr, 10);
    if (isNaN(prNumber) || prNumber <= 0) {
        console.error('エラー: PULL_REQUEST_NUMBER は正の整数である必要があります');
        process.exit(1);
    }

    // ワークスペースディレクトリを作成
    if (!existsSync(WORKSPACE_ROOT)) {
        mkdirSync(WORKSPACE_ROOT, { recursive: true });
    }

    // ベース指示（prompt.md + AGENTS.md）
    const baseInstructions = loadInstructions(REPO_ROOT);

    // PRレビュー専用のシステムプロンプト
    const prReviewInstructions = `${baseInstructions}
    
あなたは GitHub Actions で実行されるコードレビューエージェントです。
あなたの役割は、指定されたプルリクエストの差分（コード変更点）を分析し、コードレビューを行うことです。

## 効率的な実行のためのルール
- ファイルの内容を確認・検索する際は、何度も \`grep\` や \`cat\` などのコマンドを実行して一部を探索するのではなく、ファイル全体を \`readFile\` ツールで一回で読み込み、あなたの能力で内容を検索・把握してください。無駄なコマンド実行によるステップ消費を避けてください。
- レビュー対象の変更差分に直接関係のない、実行環境のライブラリやコード全体の動作について、過度に深掘りして調査することは避けてください。PRの差分レビューに焦点を当て、スマートにTODOリストを完了させてください。

## ワークフロー
以下の手順で作業を進めてください：

1. **TODOリストの作成**:
   - [ ] PRの差分を取得する (getPullRequestDiff)
   - [ ] 差分に含まれるファイルとコード内容を読み込んで理解する (必要に応じて readFile)
   - [ ] 変更内容に対してバグ、改善点、セキュリティ上の問題、または優れた設計についてレビューする
   - [ ] レビュー結果をPRにコメントとして投稿する (createPullRequestReview)

2. **タスクの実行**: TODOリストに従って作業を進める。
   - 変更があったすべてのファイルと内容を詳細に確認してください。
   - テストの追加やドキュメントの更新が抜けていないかもチェックしてください。
   - 指摘は具体的かつ constructive（建設的）に行い、良い実装に対しては褒めるようにしてください。
   - 最後に \`createPullRequestReview\` を呼び出して、レビューコメント（全体コメント）を投稿してください。

3. **完了報告**: レビューコメントを投稿したら、その内容を要約して結果報告をしてください。
`;

    const provider = process.env.LLM_PROVIDER;
    const modelName = process.env.LLM_MODEL;
    const apiKey = process.env.LLM_API_KEY;

    // GitHub Actions環境での実行かどうかを簡易判定（CI=trueなど）
    const isCI = process.env.CI === 'true';

    console.log('=== Nano Code Reviewer ===\n');
    console.log(`Provider: ${provider || '(未設定)'}`);
    console.log(`Model: ${modelName || '(未設定)'}`);
    
    if (isCI) {
        console.log(`API Key: ${maskSecret(apiKey)}`);
        if (apiKey) {
            console.log(`::add-mask::${apiKey}`);
        }
    }
    
    console.log(`Workspace: ${WORKSPACE_ROOT}`);
    console.log(`Target PR: #${prNumber}`);
    if (yoloMode) {
        console.log('[モード] 自動承認モード (--yolo)');
    }
    if (config.sandbox) {
        console.log('[モード] サンドボックスモード (--sandbox)');
    }

    if (!provider || !modelName || !apiKey) {
        console.error('[ERROR] LLM設定が不足しています');
        process.exit(1);
    }

    const model = createModelFromEnv({ useResponses: false });

    const agent = new Agent({
        name: 'nano-code-reviewer',
        model,
        instructions: prReviewInstructions,
        tools: {
            readFile: reviewReadFile,                           // PRレビュー用の制限緩和版
            execCommand: reviewExecCommand,                     // PRレビュー用の制限緩和版
            getPullRequestDiff: reviewGetPullRequestDiff,       // PRレビュー用 (cwd: REPO_ROOT)
            createPullRequestReview: reviewCreatePullRequestReview, // PRレビュー用 (cwd: REPO_ROOT)
        },
        maxSteps: 60,
        // Yoloモードなら自動承認
        approvalFunc: yoloMode ? async (name) => {
            console.log(`[自動承認] ツール ${name} の実行を承認しました`);
            return true;
        } : undefined,
    });

    try {
        const result = await agent.generate(`プルリクエスト #${prNumber} のコードレビューを行い、コメントを投稿してください。`);
        
        if (isCI) {
             console.log('\n' + '─'.repeat(60));
             console.log(`[完了] レビューが正常に終了しました`);
             if (result.usage) {
                 console.log(`[使用トークン] ${result.usage.totalTokens} tokens`);
             }
        }
    } catch (error) {
        console.error('\n' + '─'.repeat(60));
        console.error('[ERROR] エージェント実行中にエラーが発生しました\n');
        
        if (error instanceof Error) {
            let message = error.message;
            if (apiKey) {
                message = message.replace(new RegExp(apiKey, 'g'), maskSecret(apiKey));
            }
            console.error(`原因: ${message}`);
        }
        process.exit(1);
    }
}

main();
