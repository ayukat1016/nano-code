import { readFile } from './readFile';
import { writeFile } from './writeFile';
import { editFile } from './editFile';
import { execCommand } from './execCommand';

export const allTools = [
  readFile,
  writeFile,
  editFile,
  execCommand,
];

// 他のモジュールから個々のツールオブジェクトを直接インポートできるようにするため、個別に再エクスポートを行っています。
export { readFile, writeFile, editFile, execCommand };
