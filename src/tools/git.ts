import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execCommand } from './execCommand';

const WORKSPACE_ROOT = join(process.cwd(), 'workspace');

// CLI 引数として安全に渡せる Git ref に絞る。
function validateBranchName(name: string): void {
    if (!name || name.length > 120) {
        throw new Error('ブランチ名が不正です');
    }
    if (name.startsWith('-') || name.startsWith(':')) {
        throw new Error('ブランチ名の先頭に - や : は使えません');
    }
    if (/\s/.test(name)) {
        throw new Error('ブランチ名に空白は使えません');
    }
    if (!/^[A-Za-z0-9._/-]+$/.test(name)) {
        throw new Error('ブランチ名に使用できない文字が含まれています');
    }
    if (name.includes('..') || name.includes('//') || name.endsWith('/') || name.endsWith('.')) {
        throw new Error('ブランチ名形式が不正です');
    }
}

// `git add -- <file>` に分けて渡せるよう、ファイルパスを最低限検証する。
function validateFilePath(filePath: string): void {
    if (!filePath) {
        throw new Error('ファイルパスが空です');
    }
    if (filePath.startsWith('-')) {
        throw new Error('ファイルパスの先頭に - は使えません');
    }
    if (/[\r\n\0]/.test(filePath)) {
        throw new Error('ファイルパスに不正な制御文字が含まれています');
    }
}

// 引用符や改行を含むメッセージも扱えるよう、一時ファイル経由で渡す。
function writeTempFile(content: string, prefix: string): string {
    if (!existsSync(WORKSPACE_ROOT)) {
        mkdirSync(WORKSPACE_ROOT, { recursive: true });
    }
    const tempPath = join(WORKSPACE_ROOT, `.${prefix}-${Date.now()}.txt`);
    writeFileSync(tempPath, content, 'utf-8');
    return tempPath;
}

export const createBranch = {
    name: 'createBranch',
    description: '新しいGitブランチを作成。既存ブランチがある場合は強制リセット',
    needsApproval: true,
    parameters: {
        type: 'object',
        properties: {
            branchName: {
                type: 'string',
                description: "作成するブランチ名（例: 'fix/error-handling'）"
            }
        },
        required: ['branchName']
    },
    execute: async (args: { branchName: string }) => {
        const branchName = args.branchName;
        validateBranchName(branchName);

        try {
            const result = await execCommand.execute({
                commandName: 'git',
                commandArgs: ['checkout', '-B', branchName]
            });
            return `ブランチを作成しました: ${branchName}\n${result}`;
        } catch (error) {
            throw new Error(`ブランチ作成失敗: ${error}`);
        }
    }
};

export const commit = {
    name: 'commit',
    description: '変更をコミット',
    needsApproval: true,
    parameters: {
        type: 'object',
        properties: {
            message: {
                type: 'string',
                description: 'コミットメッセージ'
            },
            files: {
                type: 'array',
                items: {
                    type: 'string'
                },
                description: 'コミットするファイルのパスのリスト'
            }
        },
        required: ['message', 'files']
    },
    execute: async (args: { message: string; files: string[] }) => {
        if (!args.message || /[\0]/.test(args.message)) {
            throw new Error('コミットメッセージが不正です');
        }

        try {
            const status = await execCommand.execute({
                commandName: 'git',
                commandArgs: ['status', '--porcelain']
            });

            if (!status.trim()) {
                return 'コミットする変更がありません（既に最新の状態です）';
            }

            for (const file of args.files) {
                validateFilePath(file);
                await execCommand.execute({
                    commandName: 'git',
                    commandArgs: ['add', '--', file]
                });
            }

            const messageFile = writeTempFile(args.message, 'commit-message');
            try {
                const result = await execCommand.execute({
                    commandName: 'git',
                    commandArgs: ['commit', '-F', messageFile]
                });
                return `コミットしました: ${args.message}\n${result}`;
            } finally {
                try { unlinkSync(messageFile); } catch { /* ignore */ }
            }
        } catch (error) {
            throw new Error(`コミット失敗: ${error}`);
        }
    }
};

export const pushBranch = {
    name: 'pushBranch',
    description: 'ブランチをリモートにプッシュ',
    needsApproval: true,
    parameters: {
        type: 'object',
        properties: {
            branchName: {
                type: 'string',
                description: 'プッシュするブランチ名'
            }
        },
        required: ['branchName']
    },
    execute: async (args: { branchName: string }) => {
        validateBranchName(args.branchName);
        try {
            const result = await execCommand.execute({
                commandName: 'git',
                commandArgs: ['push', '-u', 'origin', args.branchName]
            });
            return `ブランチをプッシュしました: ${args.branchName}\n${result}`;
        } catch (error) {
            throw new Error(`プッシュ失敗: ${error}`);
        }
    }
};
