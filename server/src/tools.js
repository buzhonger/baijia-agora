// 本地操作工具：让 AI 能像 Claude Code 一样在本地干活。
// 安全策略（用户已选）：文件读写限定在工作区内；跑命令/删除等危险操作需 UI 确认。
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative, dirname, isAbsolute } from 'node:path';
import { exec } from 'node:child_process';

// 提供给 AI 的工具定义（JSON Schema）。两种协议共用。
export const TOOL_DEFS = [
  {
    name: 'read_file',
    description: '读取工作区内某个文件的内容。path 相对于工作区根目录。',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: '相对工作区的文件路径' } },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: '在工作区内写入/覆盖一个文件。会自动创建所需目录。',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对工作区的文件路径' },
        content: { type: 'string', description: '文件完整内容' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_dir',
    description: '列出工作区内某个目录下的文件和子目录。',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: '相对工作区的目录路径，根目录用 "."' } },
      required: ['path'],
    },
  },
  {
    name: 'run_command',
    description: '在工作区目录下执行一条 shell 命令（危险操作，需用户确认）。用于安装依赖、跑测试、构建等。',
    input_schema: {
      type: 'object',
      properties: { command: { type: 'string', description: '要执行的命令' } },
      required: ['command'],
    },
  },
];

// 哪些工具属于"高危操作"（Auto 模式下仍强制弹确认）。
// 目前只有 run_command：它能执行任意系统命令（删文件、装软件、联网、改配置等），
// 破坏力不受工作区沙箱约束，风险最高。
// 而 read_file / list_dir（只读）、write_file（受 safeResolve 限制、只能写入工作区目录内）
// 影响范围小，不列为高危——Auto 模式下自动放行，Normal 模式下才逐个确认。
export const DANGEROUS_TOOLS = new Set(['run_command']);

// 把用户给的相对路径解析成工作区内的绝对路径，越界则报错
function safeResolve(workspace, p) {
  const wsRoot = resolve(workspace);
  const target = isAbsolute(p) ? resolve(p) : resolve(wsRoot, p);
  const rel = relative(wsRoot, target);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`路径越界，只能访问工作区内：${p}`);
  }
  return target;
}

export async function runTool({ workspace, name, input }) {
  // 确保工作区目录存在（第一次使用时自动创建）
  const wsRoot = resolve(workspace);
  if (!existsSync(wsRoot)) mkdirSync(wsRoot, { recursive: true });

  switch (name) {
    case 'read_file': {
      const f = safeResolve(workspace, input.path);
      if (!existsSync(f)) return { ok: false, error: '文件不存在' };
      const content = readFileSync(f, 'utf8');
      return { ok: true, content: content.slice(0, 100000) };
    }
    case 'write_file': {
      const f = safeResolve(workspace, input.path);
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, input.content ?? '', 'utf8');
      return { ok: true, bytes: Buffer.byteLength(input.content ?? '') };
    }
    case 'list_dir': {
      const d = safeResolve(workspace, input.path || '.');
      if (!existsSync(d)) return { ok: false, error: '目录不存在' };
      const entries = readdirSync(d).map((n) => {
        const st = statSync(join(d, n));
        return { name: n, type: st.isDirectory() ? 'dir' : 'file', size: st.size };
      });
      return { ok: true, entries };
    }
    case 'run_command': {
      return await new Promise((res) => {
        exec(input.command, { cwd: resolve(workspace), timeout: 120000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
          res({
            ok: !err,
            exitCode: err?.code ?? 0,
            stdout: (stdout || '').slice(0, 50000),
            stderr: (stderr || '').slice(0, 50000),
            error: err ? err.message : undefined,
          });
        });
      });
    }
    default:
      return { ok: false, error: `未知工具：${name}` };
  }
}
