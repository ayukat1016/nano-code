import { describe, it, expect, afterEach } from 'bun:test';
import { writeFile } from './writeFile';
import * as fs from 'fs/promises';
import * as path from 'path';

const WORKSPACE_ROOT = path.resolve(process.cwd(), './workspace');

describe('writeFile Tool', () => {
    const testFileName = 'test-write-file.txt';
    const testFilePath = path.join(WORKSPACE_ROOT, testFileName);

    afterEach(async () => {
        try {
            await fs.unlink(testFilePath);
        } catch {}
        try {
            await fs.unlink(path.join(WORKSPACE_ROOT, 'new-dir/nested.txt'));
            await fs.rmdir(path.join(WORKSPACE_ROOT, 'new-dir'));
        } catch {}
    });

    it('should write file inside workspace successfully', async () => {
        const content = 'Hello, this is content written by writeFile tool.';
        const result = await writeFile.execute({
            path: testFileName,
            content: content
        });

        expect(result).toContain(testFileName);
        const writtenContent = await fs.readFile(testFilePath, 'utf-8');
        expect(writtenContent).toBe(content);
    });

    it('should create directories recursively if they do not exist', async () => {
        const nestedPath = 'new-dir/nested.txt';
        const nestedFilePath = path.join(WORKSPACE_ROOT, nestedPath);
        const content = 'Nested content';

        const result = await writeFile.execute({
            path: nestedPath,
            content: content
        });

        expect(result).toContain(nestedPath);
        const writtenContent = await fs.readFile(nestedFilePath, 'utf-8');
        expect(writtenContent).toBe(content);
    });

    it('should block writing file outside workspace (Path Traversal)', async () => {
        await expect(writeFile.execute({
            path: '../outside.txt',
            content: 'attempt'
        })).rejects.toThrow('アクセス拒否');
    });

    it('should block writing file through symbolic link pointing outside workspace', async () => {
        const symlinkName = 'bad-write-symlink.txt';
        const symlinkPath = path.join(WORKSPACE_ROOT, symlinkName);
        const targetPath = path.resolve(process.cwd(), './package.json');

        try {
            await fs.symlink(targetPath, symlinkPath);
            await expect(writeFile.execute({
                path: symlinkName,
                content: 'malicious attempt'
            })).rejects.toThrow('アクセス拒否');
        } finally {
            try {
                await fs.unlink(symlinkPath);
            } catch {}
        }
    });
});
