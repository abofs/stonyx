import { promises as fsp } from 'fs';
import path from 'path';
import { kebabCaseToCamelCase } from './utils/string.js';

export default class ResourceHandler {
  static async createFile(filePath, data) {
    await fsp.writeFile(filePath, data, 'utf8');
  }

  static async deleteFile(filePath) {
    await fsp.unlink(filePath);
  }

  static async deleteDirectory(dir) {
    await fsp.rm(dir, { recursive: true, force: true });
  }

  static async createDirectory(dir) {
    await fsp.mkdir(dir, { recursive: true });
  }

  static async forEachFileImport(dir, callback, options={}) {
    if (typeof callback !== 'function') throw new Error('Callback must be valid function');

    try {
      await fsp.access(dir);
    } catch (error) {
      throw new Error(`Unable to access directory: ${dir}`);
    }

    const files = await fsp.readdir(dir);

    for (const file of files) {
      const filePath = path.join(dir, file);
      const stats = await fsp.stat(filePath);

      if (!stats.isFile() || !file.endsWith('.js')) continue;

      const prefix = process.platform === 'win32' ? 'file://' : '';
      const rawName = file.replace('.js', '');
      const name = options.rawName ? rawName : kebabCaseToCamelCase(rawName);
      const exported = await import(prefix + path.resolve(filePath));
      const output = !options.fullExport ? exported.default : exported;

      callback(output, { name, stats, path: filePath });
    }
  }
}

const { createFile, deleteFile, deleteDirectory, createDirectory, forEachFileImport } = ResourceHandler;
export { createFile, deleteFile, deleteDirectory, createDirectory, forEachFileImport };
