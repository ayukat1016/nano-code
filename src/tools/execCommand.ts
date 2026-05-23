import { spawn } from 'child_process';
import * as path from 'path';
import type { Tool } from '../types';

// ワークスペースのルートディレクトリ
const WORKSPACE_ROOT = path.resolve(process.cwd(), './workspace');

// 許可されたコマンド
// 本書では ['bun', 'ls', 'git', 'gh'] だが、後続の章でエージェントが
// cat/grep/find/pwd/mkdir などを多用して自律動作するため許可コマンドを追加。
const ALLOWED_COMMANDS = ['bun', 'ls', 'cat', 'grep', 'find', 'pwd', 'mkdir', 'git', 'gh'];

// 出力サイズの上限（文字数）
const MAX_OUTPUT_LENGTH = 2048; // 本書の 2048 文字制限に揃える

// 危険な文字の正規表現
const dangerousChars = /[;&`$|]/;

type Quote = '"' | "'" | null;

// Google (Gemini) や Anthropic の Function Calling で、
// LLMが引数をオブジェクト（commandName, commandArgs）で返してくるケースに対応するための機能拡張。
// ※本書のスキーマ定義（commandプロパティのみを要求する形）と整合させつつ、一部のプロバイダー（SDK）の
//   挙動の違いを安全に吸収するための、配布リポジトリ独自の内部的な互換処理です。
type ExecCommandInput = {
    command?: unknown;
    commandName?: unknown;
    commandArgs?: unknown;
};

// ============================
// parseCommand：コマンド文字列の解析（Bash互換パーサ）
// ============================
export function parseCommand(input: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let quote: Quote = null;
    let escaped = false;

    for (let i = 0; i < input.length; i++) {
        const ch = input[i] as string;

        // クォート内の処理
        if (quote) {
            if (escaped) {
                current += ch;
                escaped = false;
                continue;
            }

            if (ch === '\\' && quote === '"') {
                escaped = true;
                continue;
            }

            if (ch === quote) {
                quote = null;
                continue;
            }

            current += ch;
            continue;
        }

        // 引用符のエスケープ以外ではバックスラッシュを保持（Windowsパス対応）
        if (ch === '\\') {
            const nextCh = input[i + 1];
            if (nextCh === '"' || nextCh === "'") {
                current += nextCh;
                i++;
                continue;
            }
            current += ch;
            continue;
        }

        // クォート開始
        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }

        // 空白で分割
        if (/\s/.test(ch)) {
            if (current.length > 0) {
                tokens.push(current);
                current = '';
            }
            continue;
        }

        current += ch;
    }

    if (quote) {
        throw new Error(`閉じられていない引用符: ${quote}`);
    }

    if (current.length > 0) {
        tokens.push(current);
    }

    return tokens;
}

// ============================
// execCommandExecute：安全なコマンド実行
// ============================
// 【本書の記述との差異】
// 本文で紹介している execCommand の実装はシンプルですが、本コードでは以下の堅牢化を行っています：
// 1. 引数のオブジェクト対応：GeminiやAnthropicで引数が commandName / commandArgs で返るケースをサポート
// 2. 危険コマンド検知：rm -rf や curl|sh などの破壊的コマンドを事前にブロック（dangerousPatterns）
// 3. 厳格なパス検証：引数の相対パスや絶対パスによるワークスペース外へのアクセス防御を強化
// 4. コマンド失敗時の例外スロー：終了コード非ゼロ時に reject(new Error) してエージェントに失敗を認識させる
// ※なお、4.5節の解説スニペットでは関数名が execCommand となっていますが、オブジェクト名との名前衝突を
//   避けるため、本書の最終コードと同様に execCommandExecute と命名しています。
async function execCommandExecute(args: Record<string, unknown>): Promise<string> {
    const input = args as ExecCommandInput;
    let commandName = '';
    let commandArgs: string[] = [];
    let commandForCheck = '';

    // コマンド引数の解析
    if (typeof input.command === 'string') {
        const command = input.command;
        // 1. 危険文字チェック
        if (dangerousChars.test(command)) {
            throw new Error('セキュリティ上の理由により、シェルメタ文字を含むコマンドは実行できません');
        }

        // 2. コマンドの解析
        const parts = parseCommand(command);
        commandName = parts[0] || '';
        commandArgs = parts.slice(1);
        commandForCheck = command;
    } else if (typeof input.commandName === 'string') {
        commandName = input.commandName;
        if (Array.isArray(input.commandArgs)) {
            if (!input.commandArgs.every((arg) => typeof arg === 'string')) {
                throw new Error('commandArgs は文字列配列で指定してください');
            }
            commandArgs = input.commandArgs as string[];
        }
        commandForCheck = [commandName, ...commandArgs].join(' ');
    } else {
        throw new Error('command または commandName を指定してください');
    }

    if (!commandName) {
        throw new Error('コマンドが空です');
    }

    // 3. ホワイトリストチェック
    if (!ALLOWED_COMMANDS.includes(commandName)) {
        throw new Error(`コマンド ${commandName} は許可されていません`);
    }

    // 【実用上のセキュリティ強化】
    // 本書に記載の危険パターン検知（dangerousPatterns）は簡易的なチェックです。
    // 許可されたコマンドであっても、find -exec や git --git-dir のように、
    // オプションや引数の値に危険なパラメータが指定されると検知をすり抜ける制限があります。
    // このコードでは、実用上の安全性を高めるため、そうした危険なオプションもパターンに追加してブロックしています。
    // 実務でサンドボックスなしで運用する場合は、実行可能なサブコマンドなどを厳しく絞り込む対策を推奨します。

    // 本書には記述されていないが、rm -rf などの破壊的なコマンドや外部スクリプトの
    // 実行、および危険なオプション指定を水際で防御するためのセキュリティ上の追加機能。
    const dangerousPatterns = [
        /rm\s+-rf/,
        />\s*\/dev/,
        /curl.*\|.*sh/,
        /wget.*\|.*sh/,
        /\s+--git-dir\b/,
        /\s+--work-tree\b/,
        /\s+-exec\b/,
        /\s+-delete\b/
    ];
    for (const pattern of dangerousPatterns) {
        if (pattern.test(commandForCheck)) {
            throw new Error('危険なコマンドパターンが検出されました');
        }
    }

    // 4. パス引数の検証（ワークスペース内かチェック）
    for (const arg of commandArgs) {
        // パスが '/' や '.' で始まる場合のトラバーサル漏れを防ぐためのセキュリティガード拡張。
        if (arg.startsWith('/') || arg.startsWith('.') || arg.includes('/') || arg.includes('\\')) {
            const resolvedPath = path.resolve(WORKSPACE_ROOT, arg);
            const allowedPrefix = WORKSPACE_ROOT + path.sep;
            if (!resolvedPath.startsWith(allowedPrefix) && resolvedPath !== WORKSPACE_ROOT) {
                throw new Error(`アクセス拒否: ${arg} はワークスペース外です`);
            }
        }
    }

    // 5. spawn()で実行（shell: falseでコマンドインジェクション対策）
    return new Promise((resolve, reject) => {
        const child = spawn(commandName, commandArgs, {
            cwd: WORKSPACE_ROOT,
            timeout: 30000,
            shell: false, // シェルを介さない
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
                // stderrは必ずしもエラーではない（gitはブランチ切替等をstderrに出力する）
                resolve(stdout + (stderr ? `\n(stderr: ${stderr.trim()})` : ''));
            } else {
                // コマンド失敗時 (code !== 0) に例外をスローすることで、
                // 呼び出し元のエージェントが失敗を認識し、自律的に回復・修正行動を取れるようにしています。
                reject(new Error(`コマンドが異常終了しました (exit code: ${code})\n${stderr}`));
            }
        });

        child.on('error', (error: Error) => {
            reject(new Error(`コマンド実行エラー: ${error.message}`));
        });
    });
}

// ============================
// ツール定義
// ============================
export const execCommand: Tool = {
    name: 'execCommand',
    description:
        'ワークスペース内で許可された汎用コマンドを実行する。利用可能：bun、ls、cat、grep、find、pwd、mkdir、git、gh。',
    // ツール実行時に人間の承認が必要かどうか（第5章で使用）
    needsApproval: true,
    parameters: {
        type: 'object',
        properties: {
            command: {
                type: 'string',
                description: '実行するコマンド（例: "bun test", "ls -la src/"）',
            },
        },
        required: ['command'],
    },
    execute: execCommandExecute,
};
