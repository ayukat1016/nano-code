import * as fs from 'fs/promises';
import * as path from 'path';

const WORKSPACE_ROOT = path.resolve(process.cwd(), './workspace');

async function writeFileExecute(args: {
  path: string;
  content: string;
}): Promise<string> {
  // ステップ1: 相対パスを絶対パスに変換
  const absolutePath = path.resolve(WORKSPACE_ROOT, args.path);

  // ステップ2: ワークスペース内かチェック（ディレクトリトラバーサル対策）
  const allowedPrefix = WORKSPACE_ROOT + path.sep;
  if (!absolutePath.startsWith(allowedPrefix) && absolutePath !== WORKSPACE_ROOT) {
    throw new Error(`アクセス拒否: ${args.path} はワークスペース外です`);
  }

  // 【実用上のセキュリティ強化】
  // 本書に記載の文字列比較（startsWith）のみでは、ワークスペース内に外部を指す
  // シンボリックリンクが存在する場合にトラバーサルを許してしまう制限があります。
  // そのため、ここでは実体パス（fs.realpath）がワークスペース内であることを検証します。
  // ファイルが新規作成の場合は、存在する親ディレクトリまで遡って検証します。
  let checkPath = absolutePath;
  while (checkPath !== WORKSPACE_ROOT) {
    try {
      const realPath = await fs.realpath(checkPath);
      if (!realPath.startsWith(allowedPrefix) && realPath !== WORKSPACE_ROOT) {
        throw new Error(`アクセス拒否: ${args.path} はシンボリックリンク経由でワークスペース外を参照しています`);
      }
      break;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        checkPath = path.dirname(checkPath);
      } else {
        throw error;
      }
    }
  }

  // ステップ3: ディレクトリの作成（存在しない場合）
  const dir = path.dirname(absolutePath);
  await fs.mkdir(dir, { recursive: true });

  // ステップ4: ファイルの書き込み
  await fs.writeFile(absolutePath, args.content, 'utf-8');

  return `ファイルを書き込みました: ${args.path}`;
}

export const writeFile = {
  name: "writeFile",
  description: "指定されたパスにファイルを作成または上書きする。ディレクトリが存在しない場合は自動的に作成される。",
  // ツール実行時に人間の承認が必要かどうか（第5章で使用）
  needsApproval: true,
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "書き込むファイルのパス"
      },
      content: {
        type: "string",
        description: "ファイルに書き込む内容"
      }
    },
    required: ["path", "content"]
  },
  execute: writeFileExecute
};
