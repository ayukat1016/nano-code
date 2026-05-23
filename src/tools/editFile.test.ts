import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { editFile } from './editFile';
import * as fs from 'fs/promises';
import * as path from 'path';

const WORKSPACE_ROOT = path.resolve(process.cwd(), './workspace');

describe('editFile Tool', () => {
    const testFileName = 'test-edit-file.txt';
    const testFilePath = path.join(WORKSPACE_ROOT, testFileName);
    const initialContent = 'line 1: AAA\nline 2: BBB\nline 3: AAA\n';

    beforeEach(async () => {
        await fs.mkdir(WORKSPACE_ROOT, { recursive: true });
        await fs.writeFile(testFilePath, initialContent, 'utf-8');
    });

    afterEach(async () => {
        try {
            await fs.unlink(testFilePath);
        } catch {}
    });

    it('should edit file text successfully if target matches exactly once', async () => {
        const result = await editFile.execute({
            path: testFileName,
            oldText: 'line 2: BBB',
            newText: 'line 2: CCC'
        });

        expect(result).toContain('ファイルを編集しました');
        const content = await fs.readFile(testFilePath, 'utf-8');
        expect(content).toBe('line 1: AAA\nline 2: CCC\nline 3: AAA\n');
    });

    it('should throw an error if target text is not found', async () => {
        await expect(editFile.execute({
            path: testFileName,
            oldText: 'line X: ZZZ',
            newText: 'line X: YYY'
        })).rejects.toThrow('変更対象が見つかりません');
    });

    it('should throw an error if target text matches multiple times', async () => {
        await expect(editFile.execute({
            path: testFileName,
            oldText: 'AAA',
            newText: 'XXX'
        })).rejects.toThrow('複数の候補が見つかりました');
    });

    it('should block editing file outside workspace (Path Traversal)', async () => {
        await expect(editFile.execute({
            path: '../outside.txt',
            oldText: 'AAA',
            newText: 'XXX'
        })).rejects.toThrow('アクセス拒否');
    });

    it('should block editing file through symbolic link pointing outside workspace', async () => {
        const symlinkName = 'bad-edit-symlink.txt';
        const symlinkPath = path.join(WORKSPACE_ROOT, symlinkName);
        const targetPath = path.resolve(process.cwd(), './package.json');

        try {
            await fs.symlink(targetPath, symlinkPath);
            await expect(editFile.execute({
                path: symlinkName,
                oldText: 'AAA',
                newText: 'XXX'
            })).rejects.toThrow('アクセス拒否');
        } finally {
            try {
                await fs.unlink(symlinkPath);
            } catch {}
        }
    });
});
