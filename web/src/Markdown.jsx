import React, { useMemo, useEffect, useRef } from 'react';
import { marked } from 'marked';
// 用精简核心版，只按需注册常用语言，避免把上百种语言全打包（体积从 380KB 降回几十 KB）
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml'; // 含 HTML
import css from 'highlight.js/lib/languages/css';
import bash from 'highlight.js/lib/languages/bash';
import sql from 'highlight.js/lib/languages/sql';
import markdownLang from 'highlight.js/lib/languages/markdown';
import 'highlight.js/styles/github-dark.css';

for (const [name, lang] of Object.entries({ javascript, typescript, python, json, xml, css, bash, sql, markdown: markdownLang })) {
  hljs.registerLanguage(name, lang);
}
// 常用别名
hljs.registerAliases(['js', 'jsx'], { languageName: 'javascript' });
hljs.registerAliases(['ts', 'tsx'], { languageName: 'typescript' });
hljs.registerAliases(['py'], { languageName: 'python' });
hljs.registerAliases(['html'], { languageName: 'xml' });
hljs.registerAliases(['sh', 'shell'], { languageName: 'bash' });

// 配置 marked：代码块用 highlight.js 高亮。
marked.setOptions({
  breaks: true,   // 单换行也换行，符合聊天习惯
  gfm: true,
  highlight(code, lang) {
    try {
      if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value;
      // 未指定或未注册的语言，在已注册的常用语言里自动识别
      return hljs.highlightAuto(code).value;
    } catch {
      return code;
    }
  },
});

// 极简 XSS 防护：只允许我们预期的标签，其余转义由 marked 处理。
// AI 输出基本是 markdown 文本，这里再做一层清理，去掉 script/on* 等危险内容。
function sanitize(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '');
}

// 把 @成员名 高亮（在 HTML 里、但避开代码块内部）。
function highlightMentions(html, names) {
  if (!names?.length) return html;
  // 按名字长度降序，避免短名字先匹配吃掉长名字
  const sorted = [...names].sort((a, b) => b.length - a.length);
  // 拆出 <pre>...</pre> 代码块，只在非代码段替换
  const parts = html.split(/(<pre[\s\S]*?<\/pre>)/g);
  return parts.map((seg) => {
    if (seg.startsWith('<pre')) return seg;
    let out = seg;
    for (const n of sorted) {
      const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp('@\\s*' + esc, 'g'), `<span class="mention">@${n}</span>`);
    }
    return out;
  }).join('');
}

// 渲染 markdown 文本，并给每个代码块加"复制"按钮。
export default function Markdown({ text, mentionNames }) {
  const html = useMemo(() => highlightMentions(sanitize(marked.parse(text || '')), mentionNames), [text, mentionNames]);
  const ref = useRef(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    // 所有链接改为新标签打开，避免点击后离开工作台导致正在进行的 AI 输出被中断
    root.querySelectorAll('a[href]').forEach((a) => {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    });
    // 给每个 <pre> 加复制按钮
    root.querySelectorAll('pre').forEach((pre) => {
      if (pre.querySelector('.copy-btn')) return;
      const btn = document.createElement('button');
      btn.className = 'copy-btn';
      btn.textContent = '复制';
      btn.onclick = () => {
        const code = pre.querySelector('code');
        navigator.clipboard.writeText(code ? code.innerText : pre.innerText);
        btn.textContent = '已复制';
        setTimeout(() => { btn.textContent = '复制'; }, 1500);
      };
      pre.appendChild(btn);
    });
  }, [html]);

  return <div className="markdown" ref={ref} dangerouslySetInnerHTML={{ __html: html }} />;
}
