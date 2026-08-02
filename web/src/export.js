// 导出对话为 Markdown 或 JSON，纯客户端下载。
function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function tsName(title) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  const safe = (title || '对话').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
  return `${safe}-${stamp}`;
}

export function exportMarkdown(session) {
  const lines = [`# ${session.title || '对话'}`, '', `导出时间：${new Date().toLocaleString()}`, ''];
  for (const m of session.messages || []) {
    if (m.authorType === 'system') { lines.push(`> _${m.text}_`, ''); continue; }
    const who = m.authorType === 'user' ? '🧑 我' : `${m.avatar || '🤖'} ${m.authorName}`;
    const model = m.meta?.model ? ` \`${m.meta.model}\`` : '';
    lines.push(`### ${who}${model}`, '', m.text || '', '');
  }
  download(`${tsName(session.title)}.md`, lines.join('\n'), 'text/markdown;charset=utf-8');
}

export function exportJSON(session) {
  download(`${tsName(session.title)}.json`, JSON.stringify(session, null, 2), 'application/json');
}
