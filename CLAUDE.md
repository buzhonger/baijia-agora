# AI 协作工作台 — 项目说明

## 运行方式
- 开发模式：`npm run dev` — 前端(Vite)跑在 **http://localhost:5173**，后端 API/WS 跑在 8787
- 生产/桌面模式：`npm run start`（单端口 8787 托管界面）或 `npm run desktop`（Electron 窗口）
- **网页调试时统一用前端地址 http://localhost:5173**

## 网页端调试规则（重要）
涉及网页端的调试、截图、性能分析、交互测试，直接用 chrome-devtools 的 MCP 工具自己操作，不用等用户手动截图。产品开发时跑在 http://localhost:5173。

具体：
- 用 `navigate_page` 打开页面、`take_screenshot` 截图看效果
- 用 `take_snapshot` 拿页面结构，`click` / `fill` / `fill_form` 模拟点击和填表测交互
- 报错就自己看 `list_console_messages`（控制台）和 `list_network_requests`（网络请求）
- 测性能跑 `performance_start_trace`，或 `lighthouse_audit` 出评分报告
- 改完页面自己刷新截图确认，不用让用户来回贴图

发现问题先自己定位，再告诉用户结论和修法。

## 项目结构
- `server/` — Node 后端：API + WebSocket + 编排 + 狼人杀引擎(`server/src/games/`)
- `web/` — React + Vite 前端
- `electron/` — 桌面版主进程
- `data/` — 本地存储（密钥、会话），已 gitignore，绝不上传
- `workspace/` — AI 本地操作沙盒

## 约定
- 密钥只存本地 `data/config.json`，任何情况下不写入代码、不上传
- 回复保持简洁专业，避免口语化文案（这是开源项目）
- 当发现自己第二次写出意思相同的话（例如“马上就调用”“现在发起编辑”），把这当成“立刻发出工具调用”的信号，直接发起调用，而不是再写第三句。
