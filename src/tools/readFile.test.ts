import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { readFile } from './readFile';
import * as fs from 'fs/promises';
import * as path from 'path';

const WORKSPACE_ROOT = path.resolve(process.cwd(), './workspace');

describe('readFile Tool', () => {
    const testFileName = 'test-read-file.txt';
    const testFilePath = path.join(WORKSPACE_ROOT, testFileName);
    const testContent = 'Hello, this is a test file for readFile tool.';

    beforeAll(async () => {
        await fs.mkdir(WORKSPACE_ROOT, { recursive: true });
        await fs.writeFile(testFilePath, testContent, 'utf-8');
    });

    afterAll(async () => {
        try {
            await fs.unlink(testFilePath);
        } catch {}
    });

    it('should read file inside workspace successfully', async () => {
        const result = await readFile.execute({ path: testFileName });
        expect(result).toBe(testContent);
    });

    it('should throw an error when file does not exist', async () => {
        await expect(readFile.execute({ path: 'non-existent-file.txt' }))
            .rejects.toThrow('ファイルが見つかりません');
    });

    it('should block reading file outside workspace (Path Traversal)', async () => {
        await expect(readFile.execute({ path: '../package.json' }))
            .rejects.toThrow('アクセス拒否');
    });

    it('should block reading symbolic link pointing outside workspace', async () => {
        const symlinkName = 'bad-symlink.txt';
        const symlinkPath = path.join(WORKSPACE_ROOT, symlinkName);
        
        try {
            await fs.symlink(path.resolve(process.cwd(), './package.json'), symlinkPath);
            await expect(readFile.execute({ path: symlinkName })).rejects.toThrow('アクセス拒否');
        } finally {
            try {
                await fs.unlink(symlinkPath);
            } catch {}
        }
    });

    it('should block reading file exceeding max size limit', async () => {
        const hugeFileName = 'huge-file.txt';
        const hugeFilePath = path.join(WORKSPACE_ROOT, hugeFileName);
        // 100KB超のファイルを書き込む (101KB = 101 * 1024)
        const hugeContent = 'a'.repeat(101 * 1024);

        try {
            await fs.writeFile(hugeFilePath, hugeContent, 'utf-8');
            await expect(readFile.execute({ path: hugeFileName })).rejects.toThrow('ファイルが大きすぎます');
        } finally {
            try {
                await fs.unlink(hugeFilePath);
            } catch {}
        }
    });
});
