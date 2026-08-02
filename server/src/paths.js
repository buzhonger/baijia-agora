// 统一管理本地数据目录。所有配置、会话、密钥都存本地，不上云。
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 项目根：server/ 的上一级 (ai-collab/)
export const ROOT_DIR = join(__dirname, '..', '..');

// 数据根目录：默认在项目内 data/；Electron 打包版通过 AICOLLAB_DATA_DIR
// 指向用户可写目录（因为 app 目录可能只读）。
const DATA_ROOT = process.env.AICOLLAB_DATA_DIR || join(ROOT_DIR, 'data');

export const DATA_DIR = DATA_ROOT;
export const CONFIG_FILE = join(DATA_DIR, 'config.json');
export const SESSIONS_DIR = join(DATA_DIR, 'sessions');

// 默认工作区：AI 只能在这个目录里读写文件
export const DEFAULT_WORKSPACE = process.env.AICOLLAB_WORKSPACE || join(ROOT_DIR, 'workspace');

export function ensureDirs() {
  for (const dir of [DATA_DIR, SESSIONS_DIR, DEFAULT_WORKSPACE]) {
    mkdirSync(dir, { recursive: true });
  }
}
