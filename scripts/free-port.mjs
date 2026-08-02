// 启动前释放被占用的端口（默认 8787、5173），避免 EADDRINUSE。
// 跨平台：Windows 用 netstat+taskkill，其余用 lsof+kill。
import { execSync } from 'node:child_process';

const ports = process.argv.slice(2).length ? process.argv.slice(2) : ['8787', '5173'];
const isWin = process.platform === 'win32';

for (const port of ports) {
  try {
    if (isWin) {
      const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      const pids = new Set();
      for (const line of out.split('\n')) {
        const m = line.trim().match(/LISTENING\s+(\d+)/);
        if (m) pids.add(m[1]);
      }
      for (const pid of pids) {
        try { execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' }); console.log(`释放端口 ${port}（结束进程 ${pid}）`); } catch {}
      }
    } else {
      const out = execSync(`lsof -ti tcp:${port}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      for (const pid of out.split('\n').filter(Boolean)) {
        try { execSync(`kill -9 ${pid}`, { stdio: 'ignore' }); console.log(`释放端口 ${port}（结束进程 ${pid}）`); } catch {}
      }
    }
  } catch { /* 端口没被占用，忽略 */ }
}
