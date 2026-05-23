import * as fs from 'fs/promises';
import * as path from 'path';

// ワークスペースのルートディレクトリを定義
const WORKSPACE_ROOT = path.resolve(process.cwd(), './workspace');

// 読み込み可能なファイルサイズの上限（LLMのコンテキストウィンドウ保護）
const MAX_FILE_SIZE = 100 * 1024; // 100KB

async function readFileExecute(args: { path: string }): Promise<string> {
  // ステップ1: 相対パスを絶対パスに変換
  const absolutePath = path.resolve(WORKSPACE_ROOT, args.path);

  // ステップ2: ワークスペース内かチェック（ディレクトリトラバーサル対策）
  const allowedPrefix = WORKSPACE_ROOT + path.sep;
  if (!absolutePath.startsWith(allowedPrefix) && absolutePath !== WORKSPACE_ROOT) {
    throw new Error(`アクセス拒否: ${args.path} はワークスペース外です`);
  }

  // ステップ3: シンボリックリンクを解決して実パスを検証
  let realPath: string;
  try {
    realPath = await fs.realpath(absolutePath);
  } catch (error) {
    if ((error as any).code === 'ENOENT') {
      throw new Error(`ファイルが見つかりません: ${args.path}`);
    }
    throw error;
  }

  if (!realPath.startsWith(allowedPrefix) && realPath !== WORKSPACE_ROOT) {
    throw new Error(`アクセス拒否: ${args.path} はシンボリックリンク経由でワークスペース外を参照しています`);
  }

  // ステップ4: ファイル種別とサイズのチェック
  try {
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) {
      throw new Error(`通常ファイルではありません: ${args.path}`);
    }
    if (stat.size > MAX_FILE_SIZE) {
      throw new Error(
        `ファイルが大きすぎます: ${args.path} (${Math.round(stat.size / 1024)}KB)。` +
        `100KB以下のファイルのみ読み込めます。`
      );
    }
  } catch (error) {
    // strictモードのビルドエラー回避のため as any を使用
    if ((error as any).code === 'ENOENT') {
      throw new Error(`ファイルが見つかりません: ${args.path}`);
    }
    throw error;
  }

  // ステップ5: ファイルの読み込み
  const content = await fs.readFile(absolutePath, 'utf-8');
  return content;
}

export const readFile = {
  name: "readFile",
  description: "ワークスペース内の指定されたパスのファイル内容を文字列として読み込む。ファイルが存在しない場合はエラーを返す。100KBを超える巨大ファイルは読み込めない（コンテキストウィンドウ保護のため）。相対パスまたは絶対パスを指定できる。",
  // ツール実行時に人間の承認が必要かどうか（第5章で使用）
  needsApproval: false,
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "読み込むファイルのパス（例: 'README.md', 'src/index.ts'）"
      }
    },
    required: ["path"]
  },
  execute: readFileExecute  // 上で実装した関数を紐付ける
};
