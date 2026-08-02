// Electron 主进程：启动内置后端，然后开窗口加载界面。
// 后端是同一套 server 代码（ESM），这里作为子进程拉起，保证与网页版行为一致。
import { app, BrowserWindow, shell, Menu } from 'electron';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import http from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = process.env.PORT || 8788; // 桌面版用独立端口，避免和网页开发版冲突

let serverProc = null;
let win = null;

function startServer() {
  const userData = app.getPath('userData');
  serverProc = spawn(process.execPath, [join(ROOT, 'server', 'src', 'index.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      // 数据和工作区放用户目录，保证可写、且卸载重装不丢
      AICOLLAB_DATA_DIR: join(userData, 'data'),
      AICOLLAB_WORKSPACE: join(userData, 'workspace'),
      ELECTRON_RUN_AS_NODE: '1', // 让 electron 二进制以纯 node 方式跑后端
    },
    stdio: 'inherit',
  });
  serverProc.on('exit', (code) => console.log('[server] exited', code));
}

// 轮询等后端起来再加载页面
function waitForServer(cb, tries = 0) {
  http.get(`http://localhost:${PORT}/api/config`, (res) => {
    res.resume();
    cb();
  }).on('error', () => {
    if (tries > 50) return cb(); // 最多等 ~10s
    setTimeout(() => waitForServer(cb, tries + 1), 200);
  });
}

// 自定义菜单栏，支持中英切换（初始中文）。点"语言/Language"里的选项即时切换整个菜单语言。
const BILI = 'https://space.bilibili.com/1871554482';
function buildMenu(lang = 'zh') {
  const L = (zh, en) => (lang === 'en' ? en : zh);
  const template = [
    { label: L('文件', 'File'), submenu: [{ role: 'quit', label: L('退出', 'Quit') }] },
    { label: L('编辑', 'Edit'), submenu: [
      { role: 'undo', label: L('撤销', 'Undo') },
      { role: 'redo', label: L('重做', 'Redo') },
      { type: 'separator' },
      { role: 'cut', label: L('剪切', 'Cut') },
      { role: 'copy', label: L('复制', 'Copy') },
      { role: 'paste', label: L('粘贴', 'Paste') },
      { role: 'selectAll', label: L('全选', 'Select All') },
    ] },
    { label: L('视图', 'View'), submenu: [
      { role: 'reload', label: L('刷新', 'Reload') },
      { role: 'forceReload', label: L('强制刷新', 'Force Reload') },
      { type: 'separator' },
      { role: 'resetZoom', label: L('实际大小', 'Actual Size') },
      { role: 'zoomIn', label: L('放大', 'Zoom In') },
      { role: 'zoomOut', label: L('缩小', 'Zoom Out') },
      { type: 'separator' },
      { role: 'togglefullscreen', label: L('全屏', 'Toggle Full Screen') },
      { role: 'toggleDevTools', label: L('开发者工具', 'Developer Tools') },
    ] },
    { label: L('窗口', 'Window'), submenu: [
      { role: 'minimize', label: L('最小化', 'Minimize') },
      { role: 'close', label: L('关闭', 'Close') },
    ] },
    { label: L('语言', 'Language'), submenu: [
      { label: '中文', type: 'radio', checked: lang !== 'en', click: () => buildMenu('zh') },
      { label: 'English', type: 'radio', checked: lang === 'en', click: () => buildMenu('en') },
    ] },
    { label: L('帮助', 'Help'), submenu: [
      { label: L('作者的 B 站主页', "Author's Bilibili"), click: () => shell.openExternal(BILI) },
      { label: L('关于', 'About'), click: () => shell.openExternal(BILI) },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 840, minWidth: 900, minHeight: 600,
    backgroundColor: '#0f1115',
    title: '百家 · Agora',
    webPreferences: { contextIsolation: true },
  });
  // 外部链接用系统浏览器打开（比如"去申请 API Key"）
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });
  win.loadURL(`http://localhost:${PORT}`);
}

app.whenReady().then(() => {
  buildMenu();
  startServer();
  waitForServer(createWindow);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (serverProc) serverProc.kill();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => { if (serverProc) serverProc.kill(); });
