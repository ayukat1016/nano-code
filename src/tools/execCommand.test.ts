import { describe, it, expect } from 'bun:test';
import { execCommand } from './execCommand';

describe('execCommand Tool', () => {
    it('should run allowed command successfully', async () => {
        const result = await execCommand.execute({ command: 'ls' });
        expect(result).toBeDefined();
        expect(typeof result).toBe('string');
    });

    it('should block command not in allowed list', async () => {
        await expect(execCommand.execute({ command: 'whoami' }))
            .rejects.toThrow('許可されていません');
    });

    it('should block command containing dangerous characters (command injection)', async () => {
        await expect(execCommand.execute({ command: 'ls; whoami' }))
            .rejects.toThrow('シェルメタ文字を含むコマンドは実行できません');
        await expect(execCommand.execute({ command: 'ls & whoami' }))
            .rejects.toThrow('シェルメタ文字を含むコマンドは実行できません');
        await expect(execCommand.execute({ command: 'ls `whoami`' }))
            .rejects.toThrow('シェルメタ文字を含むコマンドは実行できません');
        await expect(execCommand.execute({ command: 'ls $(whoami)' }))
            .rejects.toThrow('シェルメタ文字を含むコマンドは実行できません');
        await expect(execCommand.execute({ command: 'ls | whoami' }))
            .rejects.toThrow('シェルメタ文字を含むコマンドは実行できません');
    });

    it('should block dangerous pattern commands', async () => {
        await expect(execCommand.execute({ command: 'bun run --help rm -rf' }))
            .rejects.toThrow('危険なコマンドパターンが検出されました');
    });

    it('should block command with dangerous options', async () => {
        // find -exec の検知 (メタ文字セミコロンを含むためメタ文字エラーになる)
        await expect(execCommand.execute({ command: 'find . -exec rm -rf {} \\;' }))
            .rejects.toThrow('シェルメタ文字を含むコマンドは実行できません');
        // find -delete の検知
        await expect(execCommand.execute({ command: 'find . -delete' }))
            .rejects.toThrow('危険なコマンドパターンが検出されました');
        // git --git-dir の検知
        await expect(execCommand.execute({ command: 'git --git-dir=../.git status' }))
            .rejects.toThrow('危険なコマンドパターンが検出されました');
        // git --work-tree の検知
        await expect(execCommand.execute({ command: 'git --work-tree=/tmp status' }))
            .rejects.toThrow('危険なコマンドパターンが検出されました');
    });

    it('should block arguments referencing path outside workspace', async () => {
        await expect(execCommand.execute({ command: 'ls ../' }))
            .rejects.toThrow('アクセス拒否');
        await expect(execCommand.execute({ command: 'ls /etc' }))
            .rejects.toThrow('アクセス拒否');
    });

    it('should throw an error on command failure (non-zero exit code)', async () => {
        // ls で存在しないファイルを指定して強制終了コードを発生させる
        await expect(execCommand.execute({ command: 'ls non-existent-file-xyz' }))
            .rejects.toThrow('コマンドが異常終了しました');
    });
});
