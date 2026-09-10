#!/usr/bin/env node
/**
 * 航图笔记 · 零依赖静态站点生成器（Node >= 16）
 *
 *   node build.mjs     构建站点到 publish/
 *   node serve.mjs     本地预览 http://localhost:8080
 *
 * 文章放在 posts/ 目录，Markdown + 简单 front matter：
 * ---
 * title: 标题
 * slug: english-slug
 * date: 2026-09-07
 * description: 摘要
 * tags: a, b
 * draft: true      <- 草稿：生成页面但不进目录和 RSS
 * page: true       <- 独立页面（如关于页）：不进目录和 RSS
 * ---
 * 下划线开头的文件（如 _TEMPLATE.md）会被忽略。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const POSTS_DIR = path.join(ROOT, CFG.postsDir || 'posts');
const OUT_DIR = path.join(ROOT, CFG.outputDir || 'publish');
const TEMPLATE = fs.readFileSync(path.join(ROOT, 'template.html'), 'utf8');
// CSS 链接带构建时间戳：每次部署 URL 变化，强制所有浏览器绕过旧缓存（Cloudflare TTL 14400s 太长）
const ASSET_V = String(Math.floor(Date.now() / 1000));
const TEMPLATE_V = TEMPLATE.replace('href="style.css"', `href="style.css?v=${ASSET_V}"`);
const YEAR = new Date().getFullYear();
// GoatCounter 阅读数快照（data/gc-counts.json，由定时更新或手动写入；缺省时页面不显示阅读数）
let GC = {};
try { GC = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'gc-counts.json'), 'utf8')); } catch {}
// 工具注册表（data/tools.json）：工具主页与 sitemap 由它生成，新增工具加一条即可
let TOOLS = [];
try { TOOLS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'tools.json'), 'utf8')); } catch {}

/* ---------------- 工具 ---------------- */

const esc = (s) => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const isCJK = (c) => /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/.test(c);

// 中文行直接拼接、英文行补空格，兼顾手工换行的中英混排
function joinPara(lines) {
  let out = '';
  for (const l of lines) {
    if (!out) { out = l; continue; }
    out += (isCJK(out.slice(-1)) && isCJK(l[0]) ? '' : ' ') + l;
  }
  return out;
}

function parseFrontMatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) meta[kv[1].toLowerCase()] = kv[2].trim();
  }
  return { meta, body: m[2] };
}

/* ---------------- Markdown -> HTML（常用子集） ---------------- */

function inline(md) {
  const codes = [];
  md = md.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(`<code>${esc(c)}</code>`);
    return `\x00${codes.length - 1}\x00`;
  });
  md = esc(md);
  md = md.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1" loading="lazy">');
  md = md.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (mm, text, url) =>
    /^https?:/.test(url)
      ? `<a href="${url}" target="_blank" rel="noopener">${text}</a>`
      : `<a href="${url}">${text}</a>`);
  md = md.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  md = md.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  md = md.replace(/\x00(\d+)\x00/g, (_, n) => codes[Number(n)]);
  return md;
}

const isBlockStart = (s) =>
  /^#{1,6}\s/.test(s) || /^\s*([-*+]|\d+\.)\s/.test(s) || /^>/.test(s) ||
  /^```/.test(s) || /^(-{3,}|\*{3,})\s*$/.test(s) || s.trim().startsWith('|');

/* ---------------- 轻量语法高亮（零依赖，够用即可） ---------------- */

// 每条规则按优先级排列；正则内不要用捕获组（按第几个命中定位规则）
const CPP_RULES = [
  { cls: 'com', re: /\/\/[^\n]*|\/\*[\s\S]*?\*\// },
  { cls: 'str', re: /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/ },
  { cls: 'pre', re: /#[ \t]*\w+/ },
  { cls: 'num', re: /\b(?:0[xX][0-9a-fA-F']+|\d+(?:\.\d*)?(?:[eE][+-]?\d+)?[uUlLfF]*)\b/ },
  { cls: 'kw', re: /\b(?:alignas|alignof|auto|bool|break|case|catch|char|class|const|constexpr|continue|decltype|default|delete|do|double|else|enum|explicit|export|extern|false|final|float|for|friend|goto|if|inline|int|long|mutable|namespace|new|noexcept|nullptr|operator|override|private|protected|public|register|return|short|signed|sizeof|static|static_cast|struct|switch|template|this|throw|true|try|typedef|typename|union|unsigned|using|virtual|void|volatile|while)\b/ },
  { cls: 'fn', re: /\b[A-Za-z_]\w*(?=\s*\()/ },
  { cls: 'type', re: /std::\w+|\b[A-Z]\w*\b/ },
];
const JSON_RULES = [
  { cls: 'prop', re: /"(?:\\.|[^"\\\n])*"(?=\s*:)/ },
  { cls: 'str', re: /"(?:\\.|[^"\\\n])*"/ },
  { cls: 'num', re: /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/ },
  { cls: 'kw', re: /\b(?:true|false|null)\b/ },
];
const SH_RULES = [
  { cls: 'com', re: /#[^\n]*/ },
  { cls: 'str', re: /"[^"\n]*"|'[^'\n]*'/ },
  { cls: 'kw', re: /\$\{?\w+\}?/ },
];

function tokenize(code, rules) {
  const re = new RegExp(rules.map((r) => `(${r.re.source})`).join('|'), 'gm');
  let out = '', last = 0, m;
  while ((m = re.exec(code))) {
    if (m.index > last) out += esc(code.slice(last, m.index));
    const gi = m.slice(1).findIndex((g) => g !== undefined);
    out += `<span class="tok-${rules[gi].cls}">${esc(m[0])}</span>`;
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  return out + esc(code.slice(last));
}

function highlight(code, lang) {
  const l = (lang || '').toLowerCase();
  if (['c', 'cc', 'cpp', 'c++', 'h', 'hpp'].includes(l)) return tokenize(code, CPP_RULES);
  if (l === 'json') return tokenize(code, JSON_RULES);
  if (['bash', 'sh', 'shell', 'console'].includes(l)) return tokenize(code, SH_RULES);
  return esc(code);
}

function mdToHtml(md, toc) {
  const lines = md.split('\n');
  const out = [];
  let i = 0;

  const isTableSep = (s) => /^[\s|:-]+$/.test(s) && s.includes('-') && s.includes('|');

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    // 围栏代码块
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out.push(`<pre><code${lang ? ` class="language-${esc(lang)}"` : ''}>${highlight(buf.join('\n'), lang)}</code></pre>`);
      continue;
    }

    // 标题（h2/h3 生成锚点并进目录）
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const n = h[1].length;
      const inner = inline(h[2]);
      if (toc && (n === 2 || n === 3)) {
        const text = h[2].replace(/`([^`]+)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2').trim();
        const id = `sec-${toc.length + 1}`;
        toc.push({ level: n, text, id });
        out.push(`<h${n} id="${id}">${inner}</h${n}>`);
      } else {
        out.push(`<h${n}>${inner}</h${n}>`);
      }
      i++; continue;
    }

    // 分隔线
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

    // 引用（递归渲染内部块）
    if (/^>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      out.push(`<blockquote>${mdToHtml(buf.join('\n'))}</blockquote>`);
      continue;
    }

    // 表格
    if (line.trim().startsWith('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const parseRow = (r) => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const head = parseRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(parseRow(lines[i])); i++; }
      out.push(
        '<table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
        rows.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
        '</tbody></table>');
      continue;
    }

    // 列表（支持二级嵌套）
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
        if (m) {
          items.push({ depth: m[1].length >= 2 ? 1 : 0, ordered: /^\d+\./.test(m[2]), html: inline(m[3]) });
          i++;
        } else if (lines[i].trim() && items.length && /^\s{2,}\S/.test(lines[i])) {
          items[items.length - 1].html += '<br>' + inline(lines[i].trim());
          i++;
        } else break;
      }
      const tag = ordered ? 'ol' : 'ul';
      let html = `<${tag}>`;
      let k = 0;
      while (k < items.length) {
        if (items[k].depth === 0) {
          let inner = items[k].html;
          const sub = [];
          let j = k + 1;
          while (j < items.length && items[j].depth === 1) { sub.push(items[j]); j++; }
          if (sub.length) {
            const st = sub[0].ordered ? 'ol' : 'ul';
            inner += `<${st}>` + sub.map((s) => `<li>${s.html}</li>`).join('') + `</${st}>`;
          }
          html += `<li>${inner}</li>`;
          k = j;
        } else k++;
      }
      out.push(html + `</${tag}>`);
      continue;
    }

    // 段落
    const buf = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
      buf.push(lines[i].trim());
      i++;
    }
    out.push(`<p>${inline(joinPara(buf))}</p>`);
  }
  return out.join('\n');
}

/* ---------------- 页面模板 ---------------- */

function layout(pageTitle, metaDesc, content, ogType = "website", ogUrl = CFG.siteUrl, wide = false) {
  const fullTitle = !pageTitle || pageTitle === CFG.siteTitle
    ? CFG.siteTitle
    : `${pageTitle} · ${CFG.siteTitle}`;
  // 访问统计：config.analytics.goatcounter 填站点名（xxx.goatcounter.com）时启用
  const gc = CFG.analytics && CFG.analytics.goatcounter;
  const extraHead = gc
    ? `<script data-goatcounter="https://${esc(gc)}/count" async src="//gc.zgo.at/count.js"></script>`
    : '';
  const tpl = wide ? TEMPLATE_V.replace('<main class="wrap">', '<main class="wrap wrap-wide">') : TEMPLATE_V;
  return tpl
    .replace(/{{siteTitle}}/g, () => esc(CFG.siteTitle))
    .replace(/{{penName}}/g, () => esc(CFG.penName))
    .replace(/{{pageTitle}}/g, () => esc(fullTitle))
    .replace(/{{metaDescription}}/g, () => esc(metaDesc || CFG.description || ""))
    .replace(/{{year}}/g, () => String(YEAR))
    .replace(/{{ogType}}/g, () => esc(ogType))
    .replace(/{{ogUrl}}/g, () => esc(ogUrl))
    .replace(/{{extraHead}}/g, () => extraHead)
    .replace('{{content}}', () => content);
}

function readingMinutes(body) {
  const noCode = body.replace(/```[\s\S]*?```/g, ' ');
  const cjk = (noCode.match(/[\u4e00-\u9fff]/g) || []).length;
  const words = (noCode.replace(/[\u4e00-\u9fff]/g, ' ').match(/[A-Za-z0-9_]+/g) || []).length;
  return Math.max(1, Math.round(cjk / 350 + words / 200));
}

function tocHtml(toc) {
  if (!toc || toc.length < 3) return '';
  const items = toc.map((t) => `<li class="toc-l${t.level}"><a href="#${t.id}">${esc(t.text)}</a></li>`).join('');
  return `<aside class="toc"><div class="toc-title">目录</div><ul>${items}</ul></aside>`;
}

function prevNextHtml(p, articles) {
  const i = articles.findIndex((a) => a.slug === p.slug);
  if (i < 0) return '';
  const older = i < articles.length - 1 ? articles[i + 1] : null; // 上一篇 = 更早发布
  const newer = i > 0 ? articles[i - 1] : null;                   // 下一篇 = 更晚发布
  const cell = (post, dir) => post
    ? `<a class="pn-item pn-${dir}" href="${post.slug}.html"><span class="pn-label">${dir === 'prev' ? '← 上一篇' : '下一篇 →'}</span><span class="pn-title">${esc(post.title)}</span></a>`
    : '<span class="pn-item"></span>';
  return `<nav class="pn">${cell(older, 'prev')}${cell(newer, 'next')}</nav>`;
}

// 相关文章：共享标签最多者优先，同分取更新的一篇，最多 3 条
function relatedHtml(p, articles) {
  const scored = articles
    .filter((a) => a.slug !== p.slug)
    .map((a) => ({ a, n: a.tags.filter((t) => p.tags.includes(t)).length }))
    .filter((x) => x.n > 0)
    .sort((x, y) => (x.n !== y.n ? y.n - x.n : (x.a.date < y.a.date ? 1 : -1)))
    .slice(0, 3);
  if (!scored.length) return '';
  const items = scored.map(({ a }) => `<li><a href="${a.slug}.html">${esc(a.title)}</a></li>`).join('');
  return `<section class="related">
<h2>相关文章</h2>
<ul class="rel-list">
${items}
</ul>
</section>`;
}

function articlePage(p, articles) {
  const draftBadge = p.draft ? '<p><span class="draft-badge">草稿</span> <span style="color:var(--muted);font-size:13px;">仅本地预览，未出现在首页目录与 RSS</span></p>' : '';
  const tags = p.tags.length ? ' · ' + p.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('') : '';
  const reads = GC[`/${p.slug}.html`];
  const readsHtml = ` · <span id="gc-views" title="来自 GoatCounter + 实时计数">阅读 ${reads || 0}</span>`;
  const viewsScript = `<script>(function(){var p=location.pathname;var el=document.getElementById("gc-views");if(!el||!window.fetch)return;fetch("/api/views?path="+encodeURIComponent(p),{method:"POST"}).then(function(r){return r.json()}).then(function(j){if(j&&typeof j.views==="number"){el.textContent="阅读 "+j.views}}).catch(function(){})})();</script>`;
  return `<article class="post">
${draftBadge}
${tocHtml(p.toc)}
<h1 class="post-title">${esc(p.title)}</h1>
<div class="post-meta"><time>${esc(p.date)}</time> · 约 ${p.mins} 分钟${readsHtml}${tags}</div>
<div class="post-body">
${p.html}
</div>
${prevNextHtml(p, articles)}
${relatedHtml(p, articles)}
<p class="back"><a href="index.html">← 返回目录</a></p>
</article>
${viewsScript}
${commentsHtml()}`;
}

// 评论区：config.giscus 三项齐全时启用
function commentsHtml() {
  const g = CFG.giscus || {};
  if (!g.repo || !g.repoId || !g.categoryId) return '';
  const attrs = [
    `src="https://giscus.app/client.js"`,
    `data-repo="${esc(g.repo)}"`,
    `data-repo-id="${esc(g.repoId)}"`,
    `data-category="${esc(g.category || 'Announcements')}"`,
    `data-category-id="${esc(g.categoryId)}"`,
    `data-mapping="pathname"`,
    `data-strict="0"`,
    `data-reactions-enabled="0"`,
    `data-emit-metadata="0"`,
    `data-input-position="top"`,
    `data-theme="preferred_color_scheme"`,
    `data-lang="zh-CN"`,
    `data-loading="lazy"`,
    `crossorigin="anonymous"`,
    `async`,
  ].join(' ');
  return `<section class="comments"><h2>评论</h2>\n<script ${attrs}></script>\n<p class="comments-hint">评论基于 GitHub Discussions，需要 GitHub 账号；没有也欢迎通过 RSS 阅读器或各平台评论区交流。</p></section>`;
}

function indexPage(articles) {
  const items = articles.map((p) => {
    const reads = GC[`/${p.slug}.html`];
    const readsHtml = reads ? ` · ${reads} 阅读` : '';
    return `<li class="post-item">
  <a class="post-link" href="${p.slug}.html">${esc(p.title)}</a>
  <time class="post-date">${esc(p.date)}${readsHtml}</time>
  ${p.description ? `<p class="post-desc">${esc(p.description)}</p>` : ''}
</li>`;
  }).join('\n');
  return `<section class="intro">
<h1>${esc(CFG.siteTitle)}</h1>
<p>${esc(CFG.description)}</p>
</section>
<ul class="post-list">
${items}
</ul>`;
}

function archivePage(articles) {
  const years = [...new Set(articles.map((p) => p.date.slice(0, 4)))].sort().reverse();
  const secs = years.map((y) => {
    const list = articles.filter((p) => p.date.startsWith(y));
    const items = list
      .map((p) => `<li class="arc-item"><time>${esc(p.date.slice(5))}</time><a href="${p.slug}.html">${esc(p.title)}</a></li>`)
      .join('\n');
    return `<section class="arc-year">
<h2>${y} <span class="arc-count">${list.length} 篇</span></h2>
<ul class="arc-list">
${items}
</ul>
</section>`;
  }).join('\n');
  return `<section class="intro">
<h1>归档</h1>
<p>全部文章按时间倒序排列，共 ${articles.length} 篇。在线工具在 <a href="tools.html">工具页</a>。</p>
</section>
${secs}`;
}

const TOOL_ICONS = {
  table: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3.5" y="4.5" width="17" height="15" rx="2"></rect><path d="M3.5 9.5h17M9.5 9.5v10"></path></svg>',
  list: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8.5 6h12M8.5 12h12M8.5 18h12"></path><path d="M4 6h.01M4 12h.01M4 18h.01" stroke-width="2.6"></path></svg>',
  swap: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4 3 8l4 4M3 8h13M17 20l4-4-4-4M21 16H8"></path></svg>',
  calc: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="5" y="3.5" width="14" height="17" rx="2"></rect><path d="M8.5 7.5h7"></path><path d="M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16h.01M12 16h.01M15.5 16h.01" stroke-width="2.4"></path></svg>',
  palette: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.6 0 2.2-.9 2.2-1.9 0-.9-.7-1.4-.7-2.2 0-1 .8-1.9 2.2-1.9h1.6c2 0 3.2-1.5 3.2-3.4C20.5 6.7 16.7 3.5 12 3.5Z"></path><path d="M7.5 10.5h.01M11 7.5h.01M15.5 8.5h.01M8 15h.01" stroke-width="2.4"></path></svg>',
};
function toolsPage() {
  const cards = TOOLS.map((t) => `<li class="tool-card">
  <div class="tool-head"><span class="tool-icon">${TOOL_ICONS[t.icon] || TOOL_ICONS.table}</span><h2><a href="${esc(t.href)}">${esc(t.name)}</a></h2></div>
  <p>${esc(t.desc)}</p>
  ${t.tags && t.tags.length ? `<div class="tool-tags">${t.tags.map((x) => `<span class="tag">${esc(x)}</span>`).join('')}</div>` : ''}
</li>`).join('\n');
  return `<section class="intro">
<h1>实用工具</h1>
<p>做海图 / ECDIS 开发时自己反复要查的东西，顺手做成在线工具放在这里，随博客持续更新。缺什么工具欢迎邮件 hi@nightchart.cn 提议。</p>
</section>
<ul class="tool-list">
${cards}
</ul>
<section class="res">
<h2>推荐资源</h2>
<p>做海图 / 地图开发反复要去的官方站点，放在这里一并收藏：</p>
<ul class="res-list">
<li><a href="https://www.iho.int" target="_blank" rel="noopener">IHO 国际海道测量组织</a> —— S-57 / S-52 / S-100 系列规范的官方出处，标准文本免费下载</li>
<li><a href="https://gdal.org" target="_blank" rel="noopener">GDAL</a> —— GIS 数据读写基础库，内置 S-57 驱动，读 .000 文件的现成开源实现</li>
<li><a href="https://opencpn.org" target="_blank" rel="noopener">OpenCPN</a> —— 开源电子海图显示系统，插件架构设计值得一读</li>
<li><a href="https://maplibre.org" target="_blank" rel="noopener">MapLibre</a> —— 开源地图渲染引擎，本站源码走读系列的主角</li>
<li><a href="https://www.charts.noaa.gov" target="_blank" rel="noopener">NOAA 电子海图</a> —— 免费 S-57 / S-102 官方数据，本站工具的样例数据出自这里</li>
<li><a href="https://www.hdfgroup.org" target="_blank" rel="noopener">The HDF Group</a> —— HDF5 格式官方，S-102 / S-104 数据的封装载体</li>
</ul>
<p class="res-note">缺什么工具、或想推荐补充的资源，欢迎来信 hi@nightchart.cn。</p>
</section>`;
}

function rss(articles) {
  const items = articles.map((p) => `  <item>
    <title>${esc(p.title)}</title>
    <link>${CFG.siteUrl}/${p.slug}.html</link>
    <guid>${CFG.siteUrl}/${p.slug}.html</guid>
    <pubDate>${new Date(p.date).toUTCString()}</pubDate>
    <description>${esc(p.description)}</description>
    <content:encoded><![CDATA[${p.html.replace(/\]\]>/g, "]]]]><![CDATA[>")}]]></content:encoded>
  </item>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
<title>${esc(CFG.siteTitle)}</title>
<link>${CFG.siteUrl}</link>
<description>${esc(CFG.description)}</description>
<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
</channel></rss>`;
}

function sitemap(entries) {
  const urls = entries.map((u) => `  <url><loc>${esc(u.loc)}</loc><lastmod>${u.lastmod}</lastmod></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
}

/* ---------------- 构建 ---------------- */

function loadPosts() {
  const files = fs.readdirSync(POSTS_DIR)
    .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
    .sort();
  const posts = [];
  for (const f of files) {
    const raw = fs.readFileSync(path.join(POSTS_DIR, f), 'utf8').replace(/\r\n/g, '\n');
    const { meta, body } = parseFrontMatter(raw);
    const toc = [];
    posts.push({
      file: f,
      title: meta.title || f.replace(/\.md$/, ''),
      date: (meta.date || '').slice(0, 10),
      slug: (meta.slug || `post-${posts.length + 1}`).replace(/[^\w-]/g, '-'),
      draft: (meta.draft || '').toLowerCase() === 'true',
      isPage: (meta.page || '').toLowerCase() === 'true',
      tags: (meta.tags || '').split(/[,，]/).map((t) => t.trim()).filter(Boolean),
      description: meta.description || '',
      html: mdToHtml(body.trim(), toc),
      toc,
      mins: readingMinutes(body.trim()),
    });
  }
  return posts;
}

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

const posts = loadPosts();
// 日期降序；同日按文件名（=写作顺序）后者视为更新，保证"上一篇/下一篇"方向正确
const articles = posts.filter((p) => !p.isPage && !p.draft)
  .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : (a.file < b.file ? 1 : -1)));
const pages = posts.filter((p) => p.isPage);
const drafts = posts.filter((p) => p.draft);

for (const p of posts) {
  const content = p.isPage
    ? `<section class="page"><h1 class="post-title">${esc(p.title)}</h1><div class="post-body">${p.html}</div></section>`
    : articlePage(p, articles);
  const ogUrl = `${CFG.siteUrl}/${p.slug}.html`;
  fs.writeFileSync(
    path.join(OUT_DIR, `${p.slug}.html`),
    layout(p.title, p.description, content, p.isPage ? "website" : "article", ogUrl),
  );
}

fs.writeFileSync(path.join(OUT_DIR, 'index.html'), layout('', CFG.description, indexPage(articles)));
fs.writeFileSync(path.join(OUT_DIR, 'tools.html'), layout('实用工具', '航图笔记在线工具集：S-57 对象类码表等海图 / ECDIS 开发速查工具，随博客持续更新。', toolsPage(), 'website', `${CFG.siteUrl}/tools.html`, true));
fs.writeFileSync(path.join(OUT_DIR, 'archive.html'), layout('归档', '航图笔记全部文章归档：电子海图标准（S-57 / S-100 系列）、地图渲染与 C++ 工程实践文章目录，按时间排列。', archivePage(articles), 'website', `${CFG.siteUrl}/archive.html`));
fs.writeFileSync(path.join(OUT_DIR, 'rss.xml'), rss(articles));
fs.writeFileSync(
  path.join(OUT_DIR, 'sitemap.xml'),
  sitemap([
    { loc: `${CFG.siteUrl}/`, lastmod: new Date().toISOString().slice(0, 10) },
    // 草稿不进 sitemap，避免未发布内容被搜索引擎发现
    ...[...articles, ...pages].map((p) => ({ loc: `${CFG.siteUrl}/${p.slug}.html`, lastmod: p.date || new Date().toISOString().slice(0, 10) })),
    { loc: `${CFG.siteUrl}/tools.html`, lastmod: new Date().toISOString().slice(0, 10) },
    { loc: `${CFG.siteUrl}/archive.html`, lastmod: new Date().toISOString().slice(0, 10) },
    ...TOOLS.map((t) => ({ loc: `${CFG.siteUrl}/${t.href}`, lastmod: t.added || '2026-09-08' })),
  ]),
);

// 静态资源
fs.copyFileSync(path.join(ROOT, 'style.css'), path.join(OUT_DIR, 'style.css'));
if (fs.existsSync(path.join(ROOT, 'robots.txt'))) {
  fs.copyFileSync(path.join(ROOT, 'robots.txt'), path.join(OUT_DIR, 'robots.txt'));
}
// Google Search Console 所有权验证文件（必须长期保留在站点根目录）
const GV_FILE = 'google85e050cb5fb98b54.html';
if (fs.existsSync(path.join(ROOT, GV_FILE))) {
  fs.copyFileSync(path.join(ROOT, GV_FILE), path.join(OUT_DIR, GV_FILE));
}
// IndexNow 密钥文件（Bing/Yandex 实时推送协议的站点所有权验证，update-indexnow.mjs 使用）
// 规范要求密钥文件必须以 {密钥}.txt 命名（update-indexnow.mjs 的 keyLocation 指向它）
const IN_KEY_FILE = 'indexnow-key.txt';
if (fs.existsSync(path.join(ROOT, IN_KEY_FILE))) {
  const inKey = fs.readFileSync(path.join(ROOT, IN_KEY_FILE), 'utf8').trim();
  fs.writeFileSync(path.join(OUT_DIR, `${inKey}.txt`), inKey);
}
// 搜索引擎所有权验证文件（如 baidu_verify_*.html），命名匹配即复制
const verifyFiles = fs.readdirSync(ROOT).filter((f) => /^baidu_verify_.+\.html$/.test(f));
for (const f of verifyFiles) {
  fs.copyFileSync(path.join(ROOT, f), path.join(OUT_DIR, f));
}
if (fs.existsSync(path.join(ROOT, 'favicon.svg'))) {
  fs.copyFileSync(path.join(ROOT, 'favicon.svg'), path.join(OUT_DIR, 'favicon.svg'));
}
// 自定义域名（GitHub Pages 依据该文件绑定域名；DNS 生效前不要创建此文件，否则 github.io 会跳转到未解析域名）
if (fs.existsSync(path.join(ROOT, 'CNAME'))) {
  fs.copyFileSync(path.join(ROOT, 'CNAME'), path.join(OUT_DIR, 'CNAME'));
}
if (fs.existsSync(path.join(ROOT, 'assets'))) {
  fs.cpSync(path.join(ROOT, 'assets'), path.join(OUT_DIR, 'assets'), { recursive: true });
}

/* ---------------- S-57 对象类码表页 ---------------- */
const OBJL_CSV = path.join(ROOT, 'data', 's57-objectclasses.csv');
const OBJL_CN = {
  DEPARE: '深度区', DEPCNT: '等深线', SOUNDG: '水深点', COALNE: '海岸线', LNDARE: '陆地',
  LIGHTS: '灯标', WRECKS: '沉船', OBSTRN: '障碍物', UWTROC: '水下礁石（干出）',
  BOYLAT: '侧面浮标', BOYCAR: '方位浮标', BOYSAW: '安全水域浮标', BOYSPP: '专用浮标',
  BCNCAR: '方位立标', BCNLAT: '侧面立标', BCNISD: '孤立危险立标', BCNSAW: '安全水域立标',
  M_COVR: '图幅覆盖范围', M_QUAL: '数据质量', M_ACCY: '数据精度', M_NSYS: '航标制度',
  ADMARE: '行政管理区', HRBARE: '港口区', HRBFAC: '港口设施', TSSLPT: '分道通航航道段',
  TSSBND: '分道通航边界', TSSCRS: '分道通航交叉', TSSRON: '分道通航环形道', TSSSEP: '分道通航分隔带',
  TWRTPT: '双向航道段', RIVERS: '河流', RIVBNK: '河岸', LAKARE: '湖泊', LAKSHR: '湖岸',
  DWRTCL: '深水航路中心线', FLODOC: '浮船坞', PONTON: '浮码头', MORFAC: '系泊/绞船设施',
  CURENT: '洋流', SEAARE: '海域（命名）', DMPGRD: '倾倒区', PRCARE: '警戒区', MIPARE: '军事演习区',
  CTSARE: '货物转运区', MAGVAR: '磁差', ITDARE: '潮间带', SLCONS: '岸边建筑', GATCON: '闸门',
  DAMCON: '坝', OFSPLF: '近海平台', PIPOHD: '架空管道', PIPARE: '管道区', CBLARE: '电缆区',
  BUAARE: '建筑区', BUISGL: '单体建筑', BRIDGE: '桥梁', TIDEWY: '潮汐航道', RAPIDS: '急流',
  FSHZNE: '渔业区', FSHFAC: '渔业设施', HULKES: '废船体', ICEARE: '浮冰区', AIRARE: '机场',
  RTPBCN: '雷达应答标', RDOCAL: '无线电呼叫点', NAVLNE: '航行线', DAYMAR: '昼标',
  CTRPNT: '控制点', PILPNT: '桩', COARE: '珊瑚区', SWPARE: '扫海区', TESZNE: '临时军事区',
  UWTROC: '水下礁石/适淹礁', CTNARE: '注意区', DRYDOC: '干船坞', RESARE: '限制区'
};
// s101 对照页的补充中文（对象码表页共用）
const S101_EXTRA_CN = {
  LNDRGN: '陆地区域', LNDELV: '陆地高程', CANALS: '运河', RAILWY: '铁路', ROADWY: '道路',
  CAUSWY: '堤道', RUNWAY: '跑道', TUNNEL: '隧道', DYKCON: '堤防', FORSTC: '设防工事',
  OILBAR: '油栅', ACHARE: '锚地', ACHBRT: '锚位', VEGATN: '植被', SBDARE: '海底区域',
  SNDWAV: '沙波', WEDKLP: '海草', SPRING: '泉', WATTUR: '水况扰动',
  DISMAR: '距离标志', LOCMAG: '局部磁异常', GRIDRN: '船排滑道', LOKBSN: '船闸', CRANES: '起重机',
  CGUSTA: '海岸警卫站', RSCSTA: '救援站', STSLNE: '搁浅沉船', LITFLT: '灯浮', LITVES: '灯船',
  FOGSIG: '雾号', RADRFL: '雷达反射器', RADLNE: '雷达航线', RADSTA: '雷达站',
  FAIRWY: '进港航道', RECTRC: '推荐航线', RCRTCL: '推荐航迹', SISTAW: '信号站（警告）', BERTHS: '泊位',
  SMCFAC: '小型船艇设施', CHKPNT: '检查点', DOCARE: '船坞区', M_CSCL: '数据编绘比例尺',
  M_SDAT: '数据水平基准', M_VDAT: '数据垂直基准', M_NPUB: '非公开数据', UNSARE: '未测区', DRGARE: '疏浚区',
  WATFAL: '瀑布', LNDMRK: '陆标', M_HOPA: '平面/垂直精度（历史）'
};
const COMMON_OBJL = new Set(['DEPARE','DEPCNT','SOUNDG','COALNE','LNDARE','LIGHTS','WRECKS','OBSTRN','UWTROC','BOYLAT','BOYCAR','BOYSAW','BCNCAR','BCNLAT','BCNISD','M_COVR','M_QUAL','HRBARE','HRBFAC','TSSLPT','DWRTCL','PONTON','MORFAC','CURENT','SLCONS','GATCON','DMPGRD','PRCARE','MIPARE','CTSARE','MAGVAR','RTPBCN','RDOCAL','ITDARE','ADMARE','BRIDGE','RIVERS','LAKARE','SEAARE','FSHZNE','TIDEWY','SWPARE']);
if (fs.existsSync(OBJL_CSV)) {
  const csv = fs.readFileSync(OBJL_CSV, 'utf8');
  const rows = csv.split('\n').slice(1).filter((l) => l.trim()).map(splitCsvLine);
  const objs = rows.filter((r) => r.length >= 8 && /^[A-Z][A-Z0-9_]{1,7}$/.test(r[2] || '')).map((r) => ({
    c: parseInt(r[0], 10),
    a: r[2],
    n: r[1],
    p: (r[7] || '').split(';').filter(Boolean).map((x) => ({ Point: '点', Line: '线', Area: '面', G: '集合' }[x] || x)),
    at: ((r[3] || '') + ';' + (r[4] || '') + ';' + (r[5] || '')).split(';').filter(Boolean),
    cn: OBJL_CN[r[2]] || S101_EXTRA_CN[r[2]] || '',
    common: COMMON_OBJL.has(r[2]) ? 1 : 0,
  })).sort((a, b) => a.c - b.c);
  const objlBody = `<section class="post tool-page">
<h1 class="post-title">S-57 对象类码表</h1>
<div class="post-meta">数据来源：IHO S-57 Appendix A（经 GDAL 目录转换） · 共 ${objs.length} 类核心 ENC 对象 · <span title="随站点构建更新">更新于 ${YEAR}-09</span></div>
<p>输入缩写、英文名或中文快速过滤。带 ★ 的是渲染开发中的高频对象。不含内河水道（IW）与军用图层（AML）扩展对象。<strong>仅供开发参考，正式生产请以 IHO 原始出版物为准。</strong></p>
<p class="toolbar"><span class="search"><input id="objl-search" class="search-input" type="search" placeholder="过滤：如 DEPARE / 深度 / wreck …" aria-label="过滤对象类"></span>
<label class="check"><input id="objl-common" type="checkbox"> 只看常用 ★</label>
<button id="objl-csv" class="btn" type="button" style="padding:5px 12px">导出 CSV</button></p>
<div class="table-wrap">
<table class="data-table">
<thead><tr><th class="c-num">OBJL</th><th>缩写</th><th>英文名称</th><th>中文</th><th>图元</th><th>属性</th></tr></thead>
<tbody id="objl-body"></tbody>
</table>
</div>
<p class="tool-foot">共 <span id="objl-count">${objs.length}</span> 条 · 配套：<a href="attr.html">属性码表</a> · <a href="tools.html">← 更多工具</a> · <a href="index.html">返回目录</a></p>
<script id="objl-data" type="application/json">${JSON.stringify(objs)}</script>
<script>(function(){
  var data=JSON.parse(document.getElementById("objl-data").textContent);
  var body=document.getElementById("objl-body"),q=document.getElementById("objl-search"),onlyC=document.getElementById("objl-common");
  function esc(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;")}
  // URL 深链：objl.html?objl=DEPARE 直接预填过滤
  try { var up=new URLSearchParams(location.search).get("objl"); if(up){q.value=up;} } catch(e){}
  function render(){
    var kw=(q.value||"").trim().toLowerCase(),common=onlyC.checked,rows=[];
    for(var i=0;i<data.length;i++){var o=data[i];
      if(common&&!o.common)continue;
      if(kw){var hay=(o.a+" "+o.n+" "+o.cn+" "+o.c).toLowerCase();if(hay.indexOf(kw)<0)continue;}
      rows.push(o);
    }
    var html="";
    for(var j=0;j<rows.length;j++){var o2=rows[j];
      var pills="";if(o2.p&&o2.p.length){for(var w=0;w<o2.p.length;w++)pills+="<span class='pill'>"+o2.p[w]+"</span>";}
      var atN=o2.at?o2.at.length:0;
      var atCell=atN?"<button class='pill at-btn' data-a='"+esc(o2.a)+"' type='button'>"+atN+" 个 ▾</button>":"—";
      html+="<tr class='objl-row' data-code='"+esc(o2.a)+"'><td class='c-num'>"+o2.c+"</td><td class='c-code'><strong>"+esc(o2.a)+"</strong>"+(o2.common?"<span class='star'>★</span>":"")+"</td><td>"+esc(o2.n)+"</td><td>"+esc(o2.cn||"—")+"</td><td>"+(pills||"—")+"</td><td>"+atCell+"</td></tr>";
      if(atN){var chips="";for(var k2=0;k2<atN;k2++)chips+="<a class='pill' href='attr.html?att="+encodeURIComponent(o2.at[k2])+"'>"+esc(o2.at[k2])+"</a> ";
        html+="<tr class='subrow hidden' data-for='"+esc(o2.a)+"'><td colspan='6'>"+chips+"</td></tr>";}
    }
    body.innerHTML=html||"<tr><td colspan='6' style='padding:1rem;color:var(--muted)'>无匹配</td></tr>";
    document.getElementById("objl-count").textContent=rows.length;
  }
  body.addEventListener("click",function(ev){
    var b=ev.target.closest(".at-btn");if(!b)return;
    var code=b.getAttribute("data-a");
    var sub=body.querySelector(".subrow[data-for='"+code+"']");
    if(sub)sub.classList.toggle("hidden");
  });
  q.addEventListener("input",render);onlyC.addEventListener("change",render);render();
  document.getElementById("objl-csv").addEventListener("click",function(){
    var lines=["OBJL,缩写,英文名称,中文,图元,属性清单"];
    document.querySelectorAll("#objl-body tr").forEach(function(tr){
      var tds=Array.prototype.map.call(tr.cells,function(td){var t=td.textContent.trim().replace(/\\s+/g," ");return '"'+t.replace(/"/g,'""')+'"';});
      if(tr.classList.contains("subrow"))lines.push('"","","","","",'+tds.slice(-1)[0]);
      else lines.push(tds.join(","));
    });
    var blob=new Blob(["\\ufeff"+lines.join("\\r\\n")],{type:"text/csv;charset=utf-8"});
    var a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="s57-objectclasses.csv";
    document.body.appendChild(a);a.click();document.body.removeChild(a);setTimeout(function(){URL.revokeObjectURL(a.href)},3000);
  });
})();</script>
</section>`;
  fs.writeFileSync(path.join(OUT_DIR, 'objl.html'), layout('S-57 对象类码表', 'S-57 对象类（OBJL）在线码表：179 个核心 ENC 对象类缩写、编码、图元类型速查，支持中文与缩写过滤。', objlBody, 'website', `${CFG.siteUrl}/objl.html`, true));
}

/* ---------------- S-57 属性码表页 ---------------- */
const ATTR_CSV = path.join(ROOT, 'data', 's57-attributes.csv');
const ATTR_CN = {
  OBJNAM: '对象名称', NOBJNM: '国际对象名称', WATLEV: '水位', VALSOU: '水深值',
  DRVAL1: '安全水深下限', DRVAL2: '安全水深上限', QUASOU: '水深质量', SOUACC: '水深精度',
  TECSOU: '测深技术', VERDAT: '垂直基准面', NATSUR: '表层底质', NATQUA: '底质质量',
  EXPSOU: '测深显示方式', BOYSHP: '浮标形状', CATBOY: '浮标类别', COLOUR: '颜色',
  COLPAT: '颜色图案', TOPSHP: '顶标形状', VERLEN: '浮标水线以上高度', SECTR1: '光弧起始方位',
  SECTR2: '光弧终止方位', SIGGRP: '灯质节奏', SIGPER: '灯质周期', LITCHR: '灯光性质',
  LITVIS: '灯光视程', SCAMIN: '最小显示比例尺', SCAMAX: '最大显示比例尺', STATUS: '状态',
  CONDTN: '状况', CONVIS: '显著性', RESTRN: '限制类别', CATACH: '锚地类别',
  INFORM: '备注（本语）', NINFOM: '备注（国际）', TXTDSC: '文本描述', NTXTDS: '文本描述（国际）',
  PICREP: '图像表现', SORIND: '数据来源', SORDAT: '数据源日期', RECDAT: '记录日期',
  RECIND: '记录标识', HORCLR: '水平净空', VERCLR: '垂直净空', HORWID: '水平宽度',
  VERACC: '垂直精度', POSACC: '平面精度', CATZOC: '数据置信区类别（CATZOC）', NATION: '国家/地区',
  AGEN: '数据生产机构', CATAIR: '机场类别', CATHAF: '直升机坪类别', CATCBL: '电缆类别',
  CATPIP: '管道类别', SHPTYP: '船型', CURVEL: '流速', CURDIR: '流向', TWRSHP: '塔形',
  PRODCT: '产品', CATDIS: '离散类别'
};
const ATTR_VALS = {
  WATLEV: ['1 = 常年干出', '2 = 常年淹没', '3 = 周期性干出（潮间）', '4 = 漂浮'],
  COLOUR: ['1 = 白', '2 = 黑', '3 = 红', '4 = 绿', '5 = 蓝', '6 = 黄', '7 = 灰', '8 = 棕', '9 = 琥珀', '10 = 紫罗兰', '11 = 橙', '12 = 品红', '13 = 粉'],
  LITCHR: ['1 = 定光（F）', '2 = 闪光（Fl）', '3 = 长闪光（LFl）', '4 = 快闪光（Q）', '5 = 甚快闪光（VQ）', '6 = 明暗光（Iso）', '7 = 遮光（Occ）'],
  BOYSHP: ['1 = 圆锥形', '2 = 罐形', '3 = 球形', '4 = 柱形', '6 = 杆形', '7 = 桶形'],
  TOPSHP: ['1 = 尖朝上锥体', '2 = 尖朝下锥体', '3 = 球体'],
};
const ATTR_TYPE_CN = { A: '自由文本', E: '枚举', F: '格式化', I: '整数', L: '列表', S: '字符串' };
function splitCsvLine(line) {
  const out = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += ch; }
    else if (ch === '"') inQ = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur); return out;
}
if (fs.existsSync(ATTR_CSV)) {
  const rows = fs.readFileSync(ATTR_CSV, 'utf8').split('\n').slice(1).filter((l) => l.trim()).map(splitCsvLine);
  // 反向索引：属性 → 哪些对象类使用（从对象类 CSV 的 Attribute_A/B/C 汇总）
  const objUse = {};
  if (fs.existsSync(OBJL_CSV)) {
    fs.readFileSync(OBJL_CSV, 'utf8').split('\n').slice(1).filter((l) => l.trim()).map(splitCsvLine)
      .filter((r) => r.length >= 8 && /^[A-Z][A-Z0-9_]{1,7}$/.test(r[2] || ''))
      .forEach((r) => {
        const acr = r[2];
        ((r[3] || '') + ';' + (r[4] || '') + ';' + (r[5] || '')).split(';').filter(Boolean).forEach((a) => {
          (objUse[a] = objUse[a] || []).push(acr);
        });
      });
  }
  const attrs = rows.filter((r) => r.length >= 5 && /^[1-9]\d{0,2}$/.test(r[0].trim())).map((r) => ({
    c: parseInt(r[0], 10),
    a: r[2].trim(),
    n: r[1].trim(),
    t: r[3].trim(),
    cn: ATTR_CN[r[2].trim()] || '',
    v: ATTR_VALS[r[2].trim()] || null,
    u: objUse[r[2].trim()] || null,
  })).sort((x, y) => x.c - y.c);
  const attrBody = `<section class="post tool-page">
<h1 class="post-title">S-57 属性码表</h1>
<div class="post-meta">数据来源：IHO S-57 Appendix A Chapter 2（经 GDAL 目录转换） · 共 ${attrs.length} 项 · <span title="随站点构建更新">更新于 ${YEAR}-09</span></div>
<p>输入缩写、英文名或中文快速过滤。高频属性附枚举值中文释义。<strong>仅供开发参考，正式生产请以 IHO 原始出版物为准。</strong></p>
<p class="toolbar"><span class="search"><input id="attr-search" class="search-input" type="search" placeholder="过滤：如 WATLEV / 水位 / colour …" aria-label="过滤属性"></span><button id="attr-csv" class="btn" type="button" style="padding:5px 12px">导出 CSV</button></p>
<div class="table-wrap">
<table class="data-table">
<thead><tr><th class="c-num">ATT</th><th>缩写</th><th>英文名称</th><th>中文</th><th>类型</th></tr></thead>
<tbody id="attr-body"></tbody>
</table>
</div>
<p class="tool-foot">共 <span id="attr-count">${attrs.length}</span> 条 · 配套：<a href="objl.html">对象类码表</a> · <a href="tools.html">← 更多工具</a> · <a href="index.html">返回目录</a></p>
<script id="attr-data" type="application/json">${JSON.stringify(attrs)}</script>
<script>(function(){
  var data=JSON.parse(document.getElementById("attr-data").textContent);
  var body=document.getElementById("attr-body"),q=document.getElementById("attr-search");
  var TN={A:"自由文本",E:"枚举",F:"格式化",I:"整数",L:"列表",S:"字符串"};
  function esc(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;")}
  // URL 深链：attr.html?att=WATLEV 直接预填过滤
  try { var up=new URLSearchParams(location.search).get("att"); if(up){q.value=up;} } catch(e){}
  function render(){
    var kw=(q.value||"").trim().toLowerCase(),rows=[];
    for(var i=0;i<data.length;i++){var o=data[i];
      if(kw){var hay=(o.a+" "+o.n+" "+o.cn+" "+o.c).toLowerCase();if(hay.indexOf(kw)<0)continue;}
      rows.push(o);
    }
    var html="";
    for(var j=0;j<rows.length;j++){var o2=rows[j];
      html+="<tr><td class='c-num'>"+o2.c+"</td><td class='c-code'><strong>"+esc(o2.a)+"</strong></td><td>"+esc(o2.n)+"</td><td>"+esc(o2.cn||"—")+"</td><td>"+(o2.t?"<span class='pill'>"+esc(TN[o2.t]||o2.t)+"</span>":"—")+"</td></tr>";
      if(o2.v){var vals="";for(var w=0;w<o2.v.length;w++)vals+=(w?"　·　":"")+esc(o2.v[w]);
        html+="<tr class='subrow'><td colspan='5'>"+vals+"</td></tr>";}
      if(o2.u&&o2.u.length){var us="";for(var k2=0;k2<o2.u.length&&k2<12;k2++)us+="<a class='pill' href='objl.html?objl="+encodeURIComponent(o2.u[k2])+"'>"+esc(o2.u[k2])+"</a> ";
        us+=(o2.u.length>12?"等共 "+o2.u.length+" 个对象":"");
        html+="<tr class='subrow'><td colspan='5'><strong>用于：</strong>"+us+"</td></tr>";}
    }
    body.innerHTML=html||"<tr><td colspan='5' style='padding:1rem;color:var(--muted)'>无匹配</td></tr>";
    document.getElementById("attr-count").textContent=rows.length;
  }
  q.addEventListener("input",render);render();
  document.getElementById("attr-csv").addEventListener("click",function(){
    var lines=["ATT,缩写,英文名称,中文,类型,枚举值 / 使用对象"];
    document.querySelectorAll("#attr-body tr").forEach(function(tr){
      var tds=Array.prototype.map.call(tr.cells,function(td){var t=td.textContent.trim().replace(/\\s+/g," ");return '"'+t.replace(/"/g,'""')+'"';});
      lines.push(tds.join(","));
    });
    var blob=new Blob(["\\ufeff"+lines.join("\\r\\n")],{type:"text/csv;charset=utf-8"});
    var a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="s57-attributes.csv";
    document.body.appendChild(a);a.click();document.body.removeChild(a);setTimeout(function(){URL.revokeObjectURL(a.href)},3000);
  });
})();</script>
</section>`;
  fs.writeFileSync(path.join(OUT_DIR, 'attr.html'), layout('S-57 属性码表', 'S-57 属性（ATT）在线码表：300+ 属性缩写、编码、类型速查，含中文注释与高频枚举值释义，支持中文与缩写过滤。', attrBody, 'website', `${CFG.siteUrl}/attr.html`, true));
}

/* ---------------- S-57 ↔ S-101 要素对照页 ---------------- */
const S101_JSON = path.join(ROOT, 'data', 's57-s101-mapping.json');
if (fs.existsSync(S101_JSON)) {
  const map = JSON.parse(fs.readFileSync(S101_JSON, 'utf8'))
    .map((o) => ({ ...o, cn: OBJL_CN[o.code] || S101_EXTRA_CN[o.code] || '' }))
    .sort((a, b) => (a.code < b.code ? -1 : 1));
  const convN = map.filter((m) => m.targets && m.targets.length).length;
  const infoT = map.reduce((acc, m) => acc + (m.targets || []).filter((t) => t.kind === 'Information type').length, 0);
  const s101Body = `<section class="post tool-page">
<h1 class="post-title">S-57 ↔ S-101 要素对照</h1>
<div class="post-meta">数据来源：IHO S-57 to S-101 Conversion Guidance（conversion sub-WG 官方仓库） · 共 ${map.length} 个对象 · <span title="随站点构建更新">更新于 ${YEAR}-09</span></div>
<div class="fc-stats">
<div class="pal-card fc-stat"><div class="fc-num">${map.length}</div><div class="pal-zh">S-57 对象</div></div>
<div class="pal-card fc-stat"><div class="fc-num">${convN}</div><div class="pal-zh">可转换</div></div>
<div class="pal-card fc-stat"><div class="fc-num">${map.length - convN}</div><div class="pal-zh">不转换</div></div>
<div class="pal-card fc-stat"><div class="fc-num">${infoT}</div><div class="pal-zh">信息型目标</div></div>
</div>
<p>每个 S-57 对象在自动化转换中的 S-101 目标要素（含 DCEG 条款引用）。S-101 侧建模更细，一个 S-57 对象可能对应多个 S-101 要素；标注「不转换」的对象在 S-101 中已移除或并入其他要素。<strong>以 IHO 最新版转换文档为准。</strong></p>
<p class="toolbar"><span class="search"><input id="s101-search" class="search-input" type="search" placeholder="过滤：如 DEPARE / 深度 / Wreck / 灯标 …" aria-label="过滤对照表"></span><button id="s101-csv" class="btn" type="button" style="padding:5px 12px">导出 CSV</button></p>
<div class="table-wrap">
<table class="data-table">
<thead><tr><th>S-57 缩写</th><th>S-57 名称</th><th>中文</th><th>S-101 目标要素</th></tr></thead>
<tbody id="s101-body"></tbody>
</table>
</div>
<p class="tool-foot">共 <span id="s101-count">${map.length}</span> 条 · 配套：<a href="objl.html">对象类码表</a> · <a href="tools.html">← 更多工具</a> · <a href="index.html">返回目录</a></p>
<script id="s101-data" type="application/json">${JSON.stringify(map)}</script>
<script>(function(){
  var data=JSON.parse(document.getElementById("s101-data").textContent);
  var body=document.getElementById("s101-body"),q=document.getElementById("s101-search");
  function esc(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;")}
  // URL 深链：s57-s101.html?q=DEPARE 直接预填过滤（供 fc 工具的 S-57 别名跳转）
  try { var up=new URLSearchParams(location.search).get("q"); if(up){q.value=up;} } catch(e){}
  document.getElementById("s101-csv").addEventListener("click",function(){
    var lines=["S-57 编码,S-57 名称,中文,转换目标"];
    document.querySelectorAll("#s101-body tr").forEach(function(tr){
      var tds=Array.prototype.map.call(tr.cells,function(td){var t=td.textContent.trim().replace(/\s+/g," ");return '"'+t.replace(/"/g,'""')+'"';});
      lines.push(tds.join(","));
    });
    var blob=new Blob(["\\ufeff"+lines.join("\\r\\n")],{type:"text/csv;charset=utf-8"});
    var a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="s57-s101-conversion.csv";
    document.body.appendChild(a);a.click();document.body.removeChild(a);setTimeout(function(){URL.revokeObjectURL(a.href)},3000);
  });
  function render(){
    var kw=(q.value||"").trim().toLowerCase(),rows=[];
    for(var i=0;i<data.length;i++){var o=data[i];
      if(kw){var tg="";for(var t=0;t<o.targets.length;t++)tg+=" "+o.targets[t].name;
        var hay=(o.code+" "+o.s57name+" "+o.cn+tg).toLowerCase();if(hay.indexOf(kw)<0)continue;}
      rows.push(o);
    }
    var html="";
    for(var j=0;j<rows.length;j++){var o2=rows[j];
      var tgt="";
      if(!o2.targets.length){tgt="<span class='pill not-conv'>不转换</span>";}
      else{for(var t2=0;t2<o2.targets.length;t2++){var x=o2.targets[t2];
        var kp=x.kind==="Meta feature"?"<span class='pill'>元要素</span>":(x.kind==="Information type"?"<span class='pill'>信息型</span>":"");
        tgt+=(t2?"<br>":"")+kp+esc(x.name)+(x.clause?" <span class='ref'>DCEG "+esc(x.clause)+"</span>":"");}}
      html+="<tr><td class='c-code'><strong>"+esc(o2.code)+"</strong></td><td>"+esc(o2.s57name)+"</td><td>"+esc(o2.cn||"—")+"</td><td>"+tgt+"</td></tr>";
    }
    body.innerHTML=html||"<tr><td colspan='4' style='padding:1rem;color:var(--muted)'>无匹配</td></tr>";
    document.getElementById("s101-count").textContent=rows.length;
  }
  q.addEventListener("input",render);render();
})();</script>
</section>`;
  fs.writeFileSync(path.join(OUT_DIR, 's57-s101.html'), layout('S-57 ↔ S-101 要素对照表', 'S-57 对象类到 S-101 要素的官方转换在线对照表：160 个对象的转换目标、DCEG 条款引用与不转换清单，支持中文过滤。', s101Body, 'website', `${CFG.siteUrl}/s57-s101.html`, true));
}

/* ---------------- 坐标 / 磁差速算页（WMM2025 + 墨卡托 / UTM / 高斯） ---------------- */
// WMM 运行时算法（单源）：既嵌入页面，也在构建期用官方测试值校验
const WMM_JS = `
function WmmFactory(){
  var S=13;
  function calculate(data,glat,glon,alt,time){
    var c=data.c,cd=data.cd,k=data.k,fn=data.fn,fm=data.fm;
    var tc=new Float64Array(S*S),dp=new Float64Array(S*S),P=new Float64Array(S*S);
    var sp=new Float64Array(S),cp=new Float64Array(S),pp=new Float64Array(S);
    P[0]=1; cp[0]=1; pp[0]=1;
    var a=6378.137,b=6356.7523142,re=6371.2;
    var a2=a*a,b2=b*b,c2=a2-b2,a4=a2*a2,b4=b2*b2,c4=a4-b4;
    var dt=time-data.epoch;
    var rlon=glon*Math.PI/180,rlat=glat*Math.PI/180;
    var srlon=Math.sin(rlon),srlat=Math.sin(rlat),crlon=Math.cos(rlon),crlat=Math.cos(rlat);
    sp[1]=srlon;cp[1]=crlon;
    var q=Math.sqrt(a2-c2*srlat*srlat),q1=alt*q;
    var q2=((q1+a2)/(q1+b2))*((q1+a2)/(q1+b2));
    var ct=srlat/Math.sqrt(q2*crlat*crlat+srlat*srlat);
    var st=Math.sqrt(1-ct*ct);
    var r2=alt*alt+2*q1+(a4-c4*srlat*srlat)/(q*q);
    var r=Math.sqrt(r2);
    var dd=Math.sqrt(a2*crlat*crlat+b2*srlat*srlat);
    var ca=(alt+dd)/r,sa=c2*crlat*srlat/(r*dd);
    for(var m=2;m<S;m++){sp[m]=sp[1]*cp[m-1]+cp[1]*sp[m-1];cp[m]=cp[1]*cp[m-1]-sp[1]*sp[m-1];}
    var aor=re/r,ar=aor*aor,br=0,bt=0,bp=0,bpp=0;
    for(var n=1;n<S;n++){
      ar*=aor;
      for(var m=0;m<=n;m++){
        var idx=m*S+n;
        if(n===m){P[idx]=st*P[(m-1)*S+(n-1)];dp[idx]=st*dp[(m-1)*S+(n-1)]+ct*P[(m-1)*S+(n-1)];}
        else if(n===1&&m===0){P[idx]=ct*P[0];dp[idx]=ct*dp[0]-st*P[0];}
        else{
          if(m>n-2){P[m*S+(n-2)]=0;dp[m*S+(n-2)]=0;}
          P[idx]=ct*P[m*S+(n-1)]-k[idx]*P[m*S+(n-2)];
          dp[idx]=ct*dp[m*S+(n-1)]-st*P[m*S+(n-1)]-k[idx]*dp[m*S+(n-2)];
        }
        var tcc=c[idx]+dt*cd[idx],tcc2=0;
        if(m!==0)tcc2=c[n*S+(m-1)]+dt*cd[n*S+(m-1)];
        var par=ar*P[idx],temp1,temp2;
        if(m===0){temp1=tcc*cp[0];temp2=tcc*sp[0];}
        else{temp1=tcc*cp[m]+tcc2*sp[m];temp2=tcc*sp[m]-tcc2*cp[m];}
        bt-=ar*temp1*dp[idx];
        bp+=fm[m]*temp2*par;
        br+=fn[n]*temp1*par;
        if(st===0&&m===1){
          if(n===1)pp[n]=pp[n-1];else pp[n]=ct*pp[n-1]-k[1*S+n]*pp[n-2];
          bpp+=fm[1]*temp2*ar*pp[n];
        }
      }
    }
    if(st===0)bp=bpp;else bp/=st;
    var bx=-bt*ca-br*sa,by=bp,bz=bt*sa-br*ca;
    var bh=Math.sqrt(bx*bx+by*by);
    var F=Math.sqrt(bh*bh+bz*bz);
    var Ddeg=Math.atan2(by,bx)*180/Math.PI;
    var Inc=Math.atan2(bz,bh)*180/Math.PI;
    return {D:Ddeg,I:Inc,F:F,H:bh};
  }
  return {calculate:calculate};
}`;
const WMM_COF = path.join(ROOT, 'data', 'WMM2025.COF');
if (fs.existsSync(WMM_COF)) {
  const lines = fs.readFileSync(WMM_COF, 'utf8').split(/\r?\n/);
  const epoch = parseFloat(lines[0].trim().split(/\s+/)[0]);
  const S = 13;
  const c = new Float64Array(S * S), cd = new Float64Array(S * S);
  for (const l of lines.slice(1)) {
    const p = l.trim().split(/\s+/);
    if (p.length < 6 || p[0] === '9999') continue;
    const n = +p[0], m = +p[1];
    if (m > 12) break;
    c[m * S + n] = +p[2]; cd[m * S + n] = +p[4];
    if (m !== 0) { c[n * S + (m - 1)] = +p[3]; cd[n * S + (m - 1)] = +p[5]; }
  }
  const snorm = new Float64Array(S * S), k = new Float64Array(S * S);
  snorm[0] = 1;
  for (let n = 1; n <= 12; n++) {
    snorm[n] = snorm[n - 1] * (2 * n - 1) / n;
    let j = 2;
    for (let m = 0; m <= n; m++) {
      k[m * S + n] = ((n - 1) * (n - 1) - m * m) / ((2 * n - 1) * (2 * n - 3));
      if (m > 0) {
        snorm[n + m * S] = snorm[n + (m - 1) * S] * Math.sqrt((n - m + 1) * j / (n + m));
        j = 1;
        c[n * S + (m - 1)] *= snorm[n + m * S];
        cd[n * S + (m - 1)] *= snorm[n + m * S];
      }
      c[m * S + n] *= snorm[n + m * S];
      cd[m * S + n] *= snorm[n + m * S];
    }
  }
  k[1 * S + 1] = 0;
  const fn = new Array(S).fill(0), fm = new Array(S).fill(0);
  for (let n = 1; n <= 12; n++) { fn[n] = n + 1; fm[n] = n; }
  const WMM_DATA = { epoch, c: Array.from(c), cd: Array.from(cd), k: Array.from(k), fn, fm };

  // 构建期校验：NOAA 官方测试值（西雅图太空针塔，pygeomag 文档引用）
  const wmm = new Function(WMM_JS + ';return WmmFactory();')();
  const chk = wmm.calculate(WMM_DATA, 47.6205, -122.3493, 0, 2025.25);
  const expect = 15.065629638512593;
  if (Math.abs(chk.D - expect) > 1e-6) throw new Error(`WMM 校验失败：D=${chk.D}，期望 ${expect}`);

  const geoBody = `<section class="post tool-page">
<h1 class="post-title">坐标 / 磁差速算</h1>
<div class="post-meta">地磁模型 NOAA WMM2025（2025.0–2030.0） · 纯前端计算，离线可用 · <a href="tools.html">← 更多工具</a></div>

<section class="panel">
<h2>磁差 / 磁偏角计算</h2>
<p class="panel-desc">按经纬度与日期计算磁差（海图上的 Var.）。东偏为正（+），西偏为负（−）。<strong>航海用途请以官方海图与 ECDIS 为准。</strong></p>
<div class="field-row">
<label class="field"><span>纬度 °N</span><input id="mg-lat" class="input" type="number" step="0.0001" value="31.2304" style="width:6.8rem"></label>
<label class="field"><span>经度 °E</span><input id="mg-lon" class="input" type="number" step="0.0001" value="121.4737" style="width:6.8rem"></label>
<label class="field"><span>高程 km</span><input id="mg-alt" class="input" type="number" step="0.1" value="0" style="width:4rem"></label>
<label class="field"><span>年</span><select id="mg-y" class="select">${[2025, 2026, 2027, 2028, 2029, 2030].map((y) => `<option${y === 2026 ? ' selected' : ''}>${y}</option>`).join('')}</select></label>
<label class="field"><span>月</span><select id="mg-m" class="select">${Array.from({ length: 12 }, (_, i) => `<option${i === 8 ? ' selected' : ''}>${i + 1}</option>`).join('')}</select></label>
<button id="mg-go" class="btn" type="button">计算</button>
</div>
<div id="mg-out" class="result" aria-live="polite"></div>
</section>

<section class="panel">
<h2>批量磁差计算</h2>
<p class="panel-desc">每行一个点：<code>纬度,经度</code>（十进制度）。年份统一取下方选择、高程按 0 计算，最多 100 行。适合航线各转向点的磁差一次算完。</p>
<div class="field-row">
<label class="field"><span>年份</span><select id="bw-y" class="select">${[2025, 2026, 2027, 2028, 2029, 2030].map((y) => `<option${y === 2026 ? ' selected' : ''}>${y}</option>`).join('')}</select></label>
<button id="bw-go" class="btn" type="button">批量计算</button>
<button id="bw-copy" class="btn" type="button">复制结果</button>
</div>
<label class="field" style="width:100%"><span>输入坐标（每行一个点）</span><textarea id="bw-in" class="input" rows="6" style="width:100%;font-family:ui-monospace,Consolas,monospace;resize:vertical">31.2304,121.4737
38.9213,121.6447
55.7558,37.6173</textarea></label>
<div id="bw-out" class="result" aria-live="polite"></div>
</section>

<section class="panel">
<h2>经纬度 ↔ Web 墨卡托（EPSG:3857）</h2>
<div class="field-row">
<label class="field"><span>纬度 °N</span><input id="mc-lat" class="input" type="number" step="0.000001" value="31.2304" style="width:8rem"></label>
<label class="field"><span>经度 °E</span><input id="mc-lon" class="input" type="number" step="0.000001" value="121.4737" style="width:8rem"></label>
<button id="mc-go" class="btn" type="button">→ X / Y</button>
</div>
<div id="mc-out" class="result" aria-live="polite"></div>
<div class="field-row">
<label class="field"><span>X（m）</span><input id="mc-x" class="input" type="number" step="0.01" style="width:9rem"></label>
<label class="field"><span>Y（m）</span><input id="mc-y" class="input" type="number" step="0.01" style="width:9rem"></label>
<button id="mc-back" class="btn" type="button">→ 经纬度</button>
</div>
<div id="mc-out2" class="result" aria-live="polite"></div>
</section>

<section class="panel">
<h2>经纬度 ↔ UTM / 高斯-克吕格 3°带</h2>
<p class="panel-desc">投影带：<select id="tm-mode" class="select"><option value="utm">UTM（WGS84，6°带，k0=0.9996）</option><option value="gk">高斯-克吕格（CGCS2000，3°带，k0=1）</option></select></p>
<div class="field-row">
<label class="field"><span>纬度 °N</span><input id="tm-lat" class="input" type="number" step="0.000001" value="31.2304" style="width:8rem"></label>
<label class="field"><span>经度 °E</span><input id="tm-lon" class="input" type="number" step="0.000001" value="121.4737" style="width:8rem"></label>
<button id="tm-go" class="btn" type="button">→ 平面坐标</button>
</div>
<div id="tm-out" class="result" aria-live="polite"></div>
<div class="field-row">
<label class="field"><span>带号</span><input id="tm-zone" class="input" type="number" step="1" style="width:4rem"></label>
<label class="field"><span>东 E（m）</span><input id="tm-e" class="input" type="number" step="0.01" style="width:9rem"></label>
<label class="field"><span>北 N（m）</span><input id="tm-n" class="input" type="number" step="0.01" style="width:9.5rem"></label>
<label id="tm-sh-wrap" class="check" style="display:inline-flex;margin-bottom:4px"><input id="tm-sh" type="checkbox"> 南半球</label>
<button id="tm-back" class="btn" type="button">→ 经纬度</button>
</div>
<div id="tm-out2" class="result" aria-live="polite"></div>
<p class="panel-desc" style="margin-top:10px">UTM 南半球北坐标含 10,000,000 m 假定北（反算请填含假定北的值并勾选「南半球」）；高斯-克吕格按北半球 3°带、中央子午线 = 3×带号。</p>
</section>

<section class="panel">
<h2>经纬度 ↔ 度分秒（DMS）</h2>
<div class="field-row">
<label class="field"><span>纬度 度</span><input id="ds-latd" class="input" type="number" step="1" value="31" style="width:4.2rem"></label>
<label class="field"><span>分</span><input id="ds-latm" class="input" type="number" step="1" min="0" max="59" value="13" style="width:3.6rem"></label>
<label class="field"><span>秒</span><input id="ds-lats" class="input" type="number" step="0.01" min="0" max="59.99" value="49.4" style="width:4.6rem"></label>
<label class="field"><span>半球</span><select id="ds-ns" class="select"><option value="1">北 N</option><option value="-1">南 S</option></select></label>
<label class="field"><span>经度 度</span><input id="ds-lond" class="input" type="number" step="1" value="121" style="width:4.2rem"></label>
<label class="field"><span>分</span><input id="ds-lonm" class="input" type="number" step="1" min="0" max="59" value="28" style="width:3.6rem"></label>
<label class="field"><span>秒</span><input id="ds-lons" class="input" type="number" step="0.01" min="0" max="59.99" value="25.3" style="width:4.6rem"></label>
<label class="field"><span>半球</span><select id="ds-ew" class="select"><option value="1">东 E</option><option value="-1">西 W</option></select></label>
<button id="ds-go" class="btn" type="button">→ 十进制度</button>
</div>
<div id="ds-out" class="result" aria-live="polite"></div>
<div class="field-row">
<label class="field"><span>纬度（十进制度）</span><input id="dd-lat" class="input" type="number" step="0.000001" value="31.2304" style="width:8.5rem"></label>
<label class="field"><span>经度（十进制度）</span><input id="dd-lon" class="input" type="number" step="0.000001" value="121.4737" style="width:8.5rem"></label>
<button id="dd-back" class="btn" type="button">→ 度分秒</button>
</div>
<div id="dd-out" class="result" aria-live="polite"></div>
</section>

<section class="panel">
<h2>WGS84 ↔ GCJ02（火星坐标）</h2>
<p class="panel-desc">国测局 GCJ02 加密偏移：高德 / 腾讯等国内在线底图用它，直接叠 WGS84 数据会整体偏移数百米。偏移算法为公开通用实现；反算（GCJ02 → WGS84）为迭代近似，误差亚米级；境外坐标原样返回。</p>
<div class="field-row">
<label class="field"><span>纬度 °N</span><input id="gj-lat" class="input" type="number" step="0.000001" value="31.2304" style="width:8rem"></label>
<label class="field"><span>经度 °E</span><input id="gj-lon" class="input" type="number" step="0.000001" value="121.4737" style="width:8rem"></label>
<label class="field"><span>方向</span><select id="gj-dir" class="select"><option value="w2g">WGS84 → GCJ02</option><option value="g2w">GCJ02 → WGS84</option></select></label>
<button id="gj-go" class="btn" type="button">转换</button>
</div>
<div id="gj-out" class="result" aria-live="polite"></div>
</section>

<section class="panel">
<h2>批量转换（WGS84 ↔ GCJ02）</h2>
<p class="panel-desc">每行一个点，<code>纬度,经度</code> 逗号分隔；支持十进制度，也直接吃 <code>31°13′49.4″N</code> 这类度分秒文本（N/S/E/W 自动判半球）。结果可一键复制，方便粘进 Excel。最多 500 行。</p>
<div class="field-row">
<label class="field"><span>方向</span><select id="bt-dir" class="select"><option value="w2g">WGS84 → GCJ02</option><option value="g2w">GCJ02 → WGS84</option></select></label>
<button id="bt-go" class="btn" type="button">批量转换</button>
<button id="bt-copy" class="btn" type="button">复制输出列</button>
</div>
<label class="field" style="width:100%"><span>输入坐标（每行一个点）</span><textarea id="bt-in" class="input" rows="7" style="width:100%;font-family:ui-monospace,Consolas,monospace;resize:vertical">31.2304,121.4737
39.9042,116.4074
22.5431,114.0579
55.7558,37.6173</textarea></label>
<div id="bt-out" class="result" aria-live="polite"></div>
</section>

<p class="tool-foot">配套：<a href="objl.html">对象类码表</a> · <a href="attr.html">属性码表</a> · <a href="tools.html">← 更多工具</a> · <a href="index.html">返回目录</a></p>

<script id="wmm-data" type="application/json">${JSON.stringify(WMM_DATA)}</script>
<script>${WMM_JS}
var WMM=WmmFactory();
var WMM_DATA=JSON.parse(document.getElementById("wmm-data").textContent);
function $(id){return document.getElementById(id)}
function esc(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;")}
/* 磁差 */
function magCalc(){
  var lat=parseFloat($("mg-lat").value),lon=parseFloat($("mg-lon").value),alt=parseFloat($("mg-alt").value)||0;
  var y=parseInt($("mg-y").value,10),mo=parseInt($("mg-m").value,10);
  if(isNaN(lat)||isNaN(lon)){$("mg-out").textContent="请输入经纬度";return;}
  var t=y+(mo-0.5)/12;
  var r1=WMM.calculate(WMM_DATA,lat,lon,alt,t),r2=WMM.calculate(WMM_DATA,lat,lon,alt,t+1);
  var ew=r1.D>=0?"东偏":"西偏",rate=r2.D-r1.D;
  var warn=r1.H<6000?" <span class='hint'>⚠ 水平强度低，磁罗经不可靠</span>":"";
  $("mg-out").innerHTML="磁差 <strong>"+r1.D.toFixed(2)+"°</strong>（"+ew+" "+Math.abs(r1.D).toFixed(2)+"°） · 年变率 <strong>"+(rate>=0?"+":"")+rate.toFixed(2)+"°</strong>/年 · 磁倾角 <strong>"+r1.I.toFixed(1)+"°</strong> · 总强度 <strong>"+Math.round(r1.F)+"</strong> nT · 水平强度 <strong>"+Math.round(r1.H)+"</strong> nT"+warn;
}
$("mg-go").addEventListener("click",magCalc);magCalc();
/* 批量磁差：每行「纬度,经度」，年份统一、高程 0 */
var bwRows=[];
function bwF(){
  var y=parseInt($("bw-y").value,10);
  var lines=$("bw-in").value.split("\\n").filter(function(l){return l.trim()});
  if(lines.length>100)lines=lines.slice(0,100);
  bwRows=[];
  var rows=[],ok=0,bad=0,i,la,lo,t,r1,r2;
  for(i=0;i<lines.length;i++){
    var parts=lines[i].split(/[,，\\t]/);
    la=parseFloat(parts[0]);lo=parseFloat(parts[1]);
    if(isNaN(la)||isNaN(lo)){bad++;rows.push([lines[i],"","","无法解析"]);continue;}
    t=y+0.5;
    r1=WMM.calculate(WMM_DATA,la,lo,0,t);r2=WMM.calculate(WMM_DATA,la,lo,0,t+1);
    ok++;bwRows.push([la.toFixed(4)+","+lo.toFixed(4),(r1.D>=0?"东偏 ":"西偏 ")+Math.abs(r1.D).toFixed(2)+"°"]);
    rows.push([la.toFixed(4)+","+lo.toFixed(4),"<strong>"+r1.D.toFixed(2)+"°</strong>（"+(r1.D>=0?"东":"西")+"）",(r2.D-r1.D>=0?"+":"")+(r2.D-r1.D).toFixed(2)+"°/年",Math.round(r1.F)+" nT"]);
  }
  var html="<table class='ctable' style='width:auto'><thead><tr><th>#</th><th>纬度,经度</th><th>磁差</th><th>年变率</th><th>总强度</th></tr></thead><tbody>";
  for(i=0;i<rows.length;i++){html+="<tr><td>"+(i+1)+"</td><td>"+esc(rows[i][0])+"</td><td>"+rows[i][1]+"</td><td>"+rows[i][2]+"</td><td>"+rows[i][3]+"</td></tr>";}
  html+="</tbody></table><p class='panel-desc' style='margin:8px 0 0'>成功 "+ok+" 条"+(bad?" · 跳过 "+bad+" 条":"")+"（年份 "+y+"，高程 0）</p>";
  $("bw-out").innerHTML=html;
}
$("bw-go").addEventListener("click",bwF);bwF();
$("bw-copy").addEventListener("click",function(){
  if(!bwRows.length)return;
  var t="";for(var i=0;i<bwRows.length;i++)t+=bwRows[i][0]+" → "+bwRows[i][1]+"\\n";
  function done(){$("bw-copy").textContent="已复制 ✓";setTimeout(function(){$("bw-copy").textContent="复制结果"},1500)}
  if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(done,function(){fb()})}else fb();
  function fb(){var ta=document.createElement("textarea");ta.value=t;ta.style.position="fixed";ta.style.opacity="0";document.body.appendChild(ta);ta.select();try{document.execCommand("copy");done()}catch(e){}document.body.removeChild(ta)}
});
/* Web 墨卡托 */
function mcF(){var lat=parseFloat($("mc-lat").value),lon=parseFloat($("mc-lon").value);
  if(isNaN(lat)||isNaN(lon))return;
  var r=lat*Math.PI/180,l=lon*Math.PI/180,x=6378137*l,y=6378137*Math.log(Math.tan(Math.PI/4+r/2));
  $("mc-out").innerHTML="X = <strong>"+x.toFixed(2)+"</strong> · Y = <strong>"+y.toFixed(2)+"</strong> m";
  $("mc-x").value=x.toFixed(2);$("mc-y").value=y.toFixed(2);}
function mcB(){var x=parseFloat($("mc-x").value),y=parseFloat($("mc-y").value);
  if(isNaN(x)||isNaN(y))return;
  var a=6378137,lon=x/a*180/Math.PI,lat=(2*Math.atan(Math.exp(y/a))-Math.PI/2)*180/Math.PI;
  $("mc-out2").innerHTML="纬度 = <strong>"+lat.toFixed(6)+"</strong> · 经度 = <strong>"+lon.toFixed(6)+"</strong>";}
$("mc-go").addEventListener("click",mcF);$("mc-back").addEventListener("click",mcB);mcF();
/* UTM / 高斯-克吕格（Snyder 公式） */
var ELL={utm:{a:6378137,f:1/298.257223563,k0:0.9996},gk:{a:6378137,f:1/298.257222101,k0:1}};
function tmParams(){
  var mode=$("tm-mode").value,ell=ELL[mode],lon=parseFloat($("tm-lon").value);
  var zone,l0;
  if(mode==="utm"){zone=Math.floor((lon+180)/6)+1;l0=zone*6-183;}
  else{zone=Math.round(lon/3);l0=zone*3;}
  return {mode:mode,ell:ell,zone:zone,l0:l0,fe:500000,fn:(mode==="utm"&&parseFloat($("tm-lat").value)<0)?10000000:0};
}
function tmF(){
  var lat=parseFloat($("tm-lat").value),lon=parseFloat($("tm-lon").value);
  if(isNaN(lat)||isNaN(lon))return;
  var p=tmParams();
  var r=lat*Math.PI/180,l=(lon-p.l0)*Math.PI/180;
  var e2v=2*p.ell.f-p.ell.f*p.ell.f,ep2=e2v/(1-e2v);
  var N=p.ell.a/Math.sqrt(1-e2v*Math.sin(r)*Math.sin(r));
  var T=Math.tan(r)*Math.tan(r),C=ep2*Math.cos(r)*Math.cos(r),A=Math.cos(r)*l;
  var M=p.ell.a*((1-e2v/4-3*e2v*e2v/64-5*e2v*e2v*e2v/256)*r
    -(3*e2v/8+3*e2v*e2v/32+45*e2v*e2v*e2v/1024)*Math.sin(2*r)
    +(15*e2v*e2v/256+45*e2v*e2v*e2v/1024)*Math.sin(4*r)
    -(35*e2v*e2v*e2v/3072)*Math.sin(6*r));
  var x=p.fe+p.ell.k0*N*(A+(1-T+C)*A*A*A/6+(5-18*T+T*T+72*C-58*ep2)*A*A*A*A*A/120);
  var y=p.fn+p.ell.k0*(M+N*Math.tan(r)*(A*A/2+(5-T+9*C+4*C*C)*A*A*A*A/24+(61-58*T+T*T+600*C-330*ep2)*A*A*A*A*A*A/720));
  $("tm-out").innerHTML=(p.mode==="utm"?"UTM "+p.zone+" 带":"GK "+p.zone+" 带")+"（中央子午线 L0 = <strong>"+p.l0+"°</strong>） · E = <strong>"+x.toFixed(2)+"</strong> · N = <strong>"+y.toFixed(2)+"</strong> m";
  $("tm-zone").value=p.zone;$("tm-e").value=x.toFixed(2);$("tm-n").value=y.toFixed(2);
}
function tmB(){
  var zone=parseFloat($("tm-zone").value),e=parseFloat($("tm-e").value),n=parseFloat($("tm-n").value);
  if(isNaN(zone)||isNaN(e)||isNaN(n))return;
  var mode=$("tm-mode").value,ell=ELL[mode];
  var south=mode==="utm"&&$("tm-sh").checked;
  var l0=mode==="utm"?zone*6-183:zone*3;
  var fe=500000,k0=ell.k0;
  var e2v=2*ell.f-ell.f*ell.f,ep2=e2v/(1-e2v);
  var M=(n-(south?10000000:0))/k0;
  var mu=M/(ell.a*(1-e2v/4-3*e2v*e2v/64-5*e2v*e2v*e2v/256));
  var e1=(1-Math.sqrt(1-e2v))/(1+Math.sqrt(1-e2v));
  var p1=mu+(3*e1/2-27*e1*e1*e1/32)*Math.sin(2*mu)+(21*e1*e1/16-55*e1*e1*e1*e1/32)*Math.sin(4*mu)+(151*e1*e1*e1/96)*Math.sin(6*mu)+(1097*e1*e1*e1*e1/512)*Math.sin(8*mu);
  var s1=Math.sin(p1),c1=Math.cos(p1),t1=Math.tan(p1);
  var N1=ell.a/Math.sqrt(1-e2v*s1*s1),R1=ell.a*(1-e2v)/Math.pow(1-e2v*s1*s1,1.5);
  var T1=t1*t1,C1=ep2*c1*c1,D=(e-fe)/(N1*k0);
  var lat=p1-(N1*t1/R1)*(D*D/2-(5+3*T1+10*C1-4*C1*C1-9*ep2)*D*D*D*D/24+(61+90*T1+298*C1+45*T1*T1-252*ep2-3*C1*C1)*D*D*D*D*D*D/720);
  var lon=l0+(D-(1+2*T1+C1)*D*D*D/6+(5-2*C1+28*T1-3*C1*C1+8*ep2+24*T1*T1)*D*D*D*D*D/120)/Math.cos(p1)*180/Math.PI;
  var latd=lat*180/Math.PI,lond=lon;
  if(mode==="utm"&&lond<0&&l0+3>180)lond+=360;
  $("tm-out2").innerHTML="纬度 = <strong>"+latd.toFixed(6)+"</strong> · 经度 = <strong>"+lond.toFixed(6)+"</strong>";
}
$("tm-go").addEventListener("click",tmF);$("tm-back").addEventListener("click",tmB);tmF();
$("tm-mode").addEventListener("change",function(){$("tm-sh-wrap").style.display=$("tm-mode").value==="utm"?"inline-flex":"none";});
/* 度分秒 */
function num(id){return parseFloat($(id).value)||0}
function dsF(){
  var la=num("ds-latd")+num("ds-latm")/60+num("ds-lats")/3600, lo=num("ds-lond")+num("ds-lonm")/60+num("ds-lons")/3600;
  la*=parseFloat($("ds-ns").value); lo*=parseFloat($("ds-ew").value);
  $("ds-out").innerHTML="纬度 = <strong>"+la.toFixed(6)+"</strong> · 经度 = <strong>"+lo.toFixed(6)+"</strong>";
}
function dms(v){
  var h=v>=0?"N":"S"; v=Math.abs(v);
  var d=Math.floor(v), mf=(v-d)*60, m=Math.floor(mf), s=(mf-m)*60;
  s=Math.round(s*100)/100;
  if(s>=60){s-=60;m+=1}
  if(m>=60){m-=60;d+=1}
  return {h:h,d:d,m:m,s:s};
}
function ddF(){
  var la=parseFloat($("dd-lat").value), lo=parseFloat($("dd-lon").value);
  if(isNaN(la)||isNaN(lo))return;
  var A=dms(la), B=dms(lo);
  B.h=lo>=0?"E":"W";
  function dmStr(x){return x.d+"°"+String(x.m).padStart(2,"0")+"′"+String(x.s).padStart(2,"0")+"″ "+x.h+"（"+x.d+"°"+(x.m+x.s/60).toFixed(4)+"′）"}
  $("dd-out").innerHTML="纬度 = <strong>"+dmStr(A)+"</strong><br>经度 = <strong>"+dmStr(B)+"</strong>";
}
$("ds-go").addEventListener("click",dsF);dsF();
$("dd-back").addEventListener("click",ddF);ddF();
/* WGS84 ↔ GCJ02（火星坐标）——公开通用偏移算法，反算用 3 轮迭代近似 */
var GCJ_A=6378245.0,GCJ_EE=0.00669342162296594;
function gjOut(lat,lon){return !(lon>73.66&&lon<135.05&&lat>3.86&&lat<53.55)}
function gjTLat(x,y){var r=-100+2*x+3*y+.2*y*y+.1*x*y+.2*Math.sqrt(Math.abs(x));r+=(20*Math.sin(6*x*Math.PI)+20*Math.sin(2*x*Math.PI))*2/3;r+=(20*Math.sin(y*Math.PI)+40*Math.sin(y/3*Math.PI))*2/3;r+=(160*Math.sin(y/12*Math.PI)+320*Math.sin(y*Math.PI/30))*2/3;return r}
function gjTLon(x,y){var r=300+x+2*y+.1*x*x+.1*x*y+.1*Math.sqrt(Math.abs(x));r+=(20*Math.sin(6*x*Math.PI)+20*Math.sin(2*x*Math.PI))*2/3;r+=(20*Math.sin(x*Math.PI)+40*Math.sin(x/3*Math.PI))*2/3;r+=(150*Math.sin(x/12*Math.PI)+300*Math.sin(x/30*Math.PI))*2/3;return r}
function gjDelta(lat,lon){var dLa=gjTLat(lon-105,lat-35),dLo=gjTLon(lon-105,lat-35);var rLa=lat/180*Math.PI,m=Math.sin(rLa);m=1-GCJ_EE*m*m;var sq=Math.sqrt(m);dLa=dLa*180/((GCJ_A*(1-GCJ_EE))/(m*sq)*Math.PI);dLo=dLo*180/(GCJ_A/sq*Math.cos(rLa)*Math.PI);return[dLa,dLo]}
function gjDist(lat,lon,d){var mLa=d[0]*Math.PI/180*6378137,mLo=d[1]*Math.PI/180*6378137*Math.cos(lat*Math.PI/180);return Math.hypot(mLa,mLo)}
function wgs2gcj(lat,lon){if(gjOut(lat,lon))return[lat,lon,0];var d=gjDelta(lat,lon);return[lat+d[0],lon+d[1],gjDist(lat,lon,d)]}
function gcj2wgs(lat,lon){if(gjOut(lat,lon))return[lat,lon,0];var a=lat,o=lon,i,d;for(i=0;i<3;i++){d=gjDelta(a,o);a=lat-d[0];o=lon-d[1]}return[a,o,gjDist(lat,lon,[lat-a,lon-o])]}
function gjF(){
  var lat=parseFloat($("gj-lat").value),lon=parseFloat($("gj-lon").value);
  if(isNaN(lat)||isNaN(lon)){$("gj-out").textContent="请输入有效的经纬度";return}
  var w2g=$("gj-dir").value==="w2g",r=w2g?wgs2gcj(lat,lon):gcj2wgs(lat,lon);
  var off=r[2]<0.5?"（境外坐标，原样返回）":"，加密偏移约 <strong>"+Math.round(r[2])+"</strong> m";
  $("gj-out").innerHTML=(w2g?"GCJ02":"WGS84")+" = <strong>"+r[0].toFixed(6)+", "+r[1].toFixed(6)+"</strong>"+off;
}
$("gj-go").addEventListener("click",gjF);gjF();
/* 批量转换：每行「纬度,经度」，十进制度或度分秒文本均可 */
function toDD(s){
  s=String(s).trim();
  if(/^[+-]?\\d+(\\.\\d+)?$/.test(s))return parseFloat(s);
  var nums=s.match(/\\d+(\\.\\d+)?/g);
  if(!nums||!nums.length)return NaN;
  var v=0,mul=1,i;
  for(i=0;i<Math.min(nums.length,3);i++){v+=parseFloat(nums[i])*mul;mul/=60}
  if(/[SW]/i.test(s))v=-v;
  return v;
}
function dsStr(x){return x.d+"°"+String(x.m).padStart(2,"0")+"′"+String(x.s).padStart(2,"0")+"″ "+x.h}
var btRows=[];
function btF(){
  var lines=$("bt-in").value.split("\\n").filter(function(l){return l.trim()});
  var w2g=$("bt-dir").value==="w2g";
  var rows=[],ok=0,bad=0,i,parts,la,lo,r,A,B,trunc=lines.length>500;
  if(trunc)lines=lines.slice(0,500);
  for(i=0;i<lines.length;i++){
    parts=lines[i].split(/[,，\\t]/);
    if(parts.length<2){bad++;rows.push([lines[i],"","","行内不足两个值"]);continue}
    la=toDD(parts[0]);lo=toDD(parts[1]);
    if(isNaN(la)||isNaN(lo)){bad++;rows.push([lines[i],"","","无法解析"]);continue}
    r=w2g?wgs2gcj(la,lo):gcj2wgs(la,lo);ok++;
    A=dms(la);B=dms(lo);B.h=lo>=0?"E":"W";
    rows.push([la.toFixed(6)+","+lo.toFixed(6),r[0].toFixed(6)+","+r[1].toFixed(6),dsStr(A)+" / "+dsStr(B),gjOut(la,lo)?"境外":Math.round(r[2])+" m"]);
  }
  btRows=rows;
  var html="<table class='ctable' style='width:auto'><thead><tr><th>#</th><th>输入（纬度,经度）</th><th>输出（纬度,经度）</th><th>度分秒</th><th>偏移</th></tr></thead><tbody>";
  for(i=0;i<rows.length;i++){html+="<tr><td>"+(i+1)+"</td><td>"+esc(rows[i][0])+"</td><td><strong>"+esc(rows[i][1])+"</strong></td><td>"+esc(rows[i][2])+"</td><td>"+esc(rows[i][3])+"</td></tr>"}
  html+="</tbody></table><p class='panel-desc' style='margin:8px 0 0'>成功 "+ok+" 条"+(bad?" · 跳过 "+bad+" 条":"")+(trunc?" · 已截断为前 500 行":"")+"</p>";
  $("bt-out").innerHTML=html;
}
$("bt-go").addEventListener("click",btF);btF();
$("bt-copy").addEventListener("click",function(){
  if(!btRows.length)return;
  var t="";
  for(var i=0;i<btRows.length;i++){if(btRows[i][1])t+=btRows[i][0]+"→"+btRows[i][1]+"\\n"}
  function done(){$("bt-copy").textContent="已复制 ✓";setTimeout(function(){$("bt-copy").textContent="复制输出列"},1500)}
  if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(done,function(){fallback()})}else fallback();
  function fallback(){var ta=document.createElement("textarea");ta.value=t;ta.style.position="fixed";ta.style.opacity="0";document.body.appendChild(ta);ta.select();try{document.execCommand("copy");done()}catch(e){}document.body.removeChild(ta)}
});
</script>
</section>`;
  fs.writeFileSync(path.join(OUT_DIR, 'geo-calc.html'), layout('坐标 / 磁差速算', '在线坐标投影与磁差速算：经纬度 ↔ Web 墨卡托 / UTM / 高斯-克吕格 3°带 / 度分秒 / GCJ02 火星坐标双向换算（支持批量），WMM2025 磁差在线计算，纯前端离线可用。', geoBody, 'website', `${CFG.siteUrl}/geo-calc.html`, true));
}

/* ---------------- S-52 颜色与符号速查页 ---------------- */
const S52_COLORS = path.join(ROOT, 'data', 's52', 'colors.json');
const S52_SYMS = path.join(ROOT, 'data', 's52', 'symbols.json');
if (fs.existsSync(S52_COLORS) && fs.existsSync(S52_SYMS)) {
  const PAL_ZH = {
    DAY_BRIGHT: '白昼 · 亮背景',
    DAY_BLACKBACK: '白昼 · 黑背景',
    DAY_WHITEBACK: '白昼 · 白背景',
    DUSK: '黄昏',
    NIGHT: '夜间',
  };
  const TOKEN_ZH = {
    NODTA: '无数据区', CURSR: '光标', CHBLK: '黑（线划/注记）', CHGRD: '灰（线划/注记）',
    CHGRF: '浅灰（线划）', CHRED: '红', CHGRN: '绿', CHYLW: '黄', CHMGD: '品红（深）',
    CHMGF: '品红（浅）', CHBRN: '棕', CHWHT: '白', SCLBR: '刻度亮色', CHCOR: '图廓线',
    LITRD: '灯标红', LITGN: '灯标绿', LITYW: '灯标黄', ISDNG: '孤立危险标', DNGHL: '危险高亮',
    TRFCD: '通航分道（深）', TRFCF: '通航分道（浅）', LANDA: '陆地（线划）', LANDF: '陆地（填充）',
    CSTLN: '海岸线', SNDG1: '水深字（深水侧）', SNDG2: '水深字（浅水侧）',
    DEPSC: '安全等深线（低精度）', DEPCN: '浅水区（浅于安全等深线）', DEPDW: '深水区',
    DEPMD: '中深水区', DEPMS: '中浅水区', DEPVS: '极浅水区', DEPIT: '水深区（中间色调）',
    RADHI: '雷达高亮', RADLO: '雷达弱显', ARPAT: '图案填充', NINFO: '注记信息',
    RESBL: '预留蓝', ADINF: '附加信息', RESGR: '预留灰', SHIPS: '本船',
    PSTRK: '历史航迹', SYTRK: '系统航迹', PLRTE: '计划航线', APLRT: '批准航线段',
    UINFD: '界面信息（深）', UINFF: '界面信息（浅）', UIBCK: '界面背景', UIAFD: '界面区（深）',
    UINFR: '界面红', UINFG: '界面绿', UINFO: '界面橙', UINFB: '界面蓝', UINFM: '界面品红',
    UIBDR: '界面边界', UIAFF: '界面区（浅）', OUTLW: '外框（白）', OUTLL: '外框（线）',
    RES01: '预留 1', RES02: '预留 2', RES03: '预留 3', BKAJ1: '备用底色 1', BKAJ2: '备用底色 2',
  };
  const palettes = JSON.parse(fs.readFileSync(S52_COLORS, 'utf8'));
  const { cats, syms } = JSON.parse(fs.readFileSync(S52_SYMS, 'utf8'));
  const palNames = Object.keys(palettes);

  const palHead = palNames.map((p) => `<th class="pal-col">${PAL_ZH[p] || p}</th>`).join('');
  const palRows = Object.entries(palettes[palNames[0]]).map(([tok]) => {
    const cells = palNames.map((p) => {
      const hex = palettes[p][tok];
      return `<td><button class="pal-swatch" type="button" data-hex="${hex}" title="点击复制 ${hex}"><span class="chip" style="background:${hex}"></span><span class="hex">${hex}</span></button></td>`;
    }).join('');
    return `<tr><td class="c-code"><strong>${tok}</strong></td><td class="pal-zh-cell">${TOKEN_ZH[tok] || ''}</td>${cells}</tr>`;
  }).join('\n');

  const catPills = ['全部', ...Object.entries(cats).map(([k, v]) => `${k}·${v}`)]
    .map((c, i) => `<button class="pill${i === 0 ? ' on' : ''}" data-cat="${c === '全部' ? '*' : c[0]}" type="button">${c}</button>`).join('');
  const symCards = syms.map((s) => `<figure class="sym-card" data-cat="${s.cat}" data-s="${(s.int1 + ' ' + s.en + ' ' + s.zh + ' ' + (s.obj || '')).toLowerCase()}">
    <span class="sym-art"><img loading="lazy" src="${s.f}" alt="${esc(s.zh)}"></span>
    <figcaption><span class="sym-int1">${s.int1}</span> ${esc(s.zh)}<span class="sym-en">${esc(s.en)}</span>${s.obj ? `<span class="sym-obj">${s.obj}</span>` : ''}</figcaption>
  </figure>`).join('\n');

  const s52Body = `<section class="post tool-page">
<h1 class="post-title">S-52 颜色与符号速查</h1>
<div class="post-meta">符号来源：Esri nautical-chart-symbols（Apache-2.0）· 颜色值参考 IHO S-52 PresLib Ed 4.0（经开源实现交叉核对）· ${syms.length} 个常用符号 · 5 套标准调色板 · 更新于 ${YEAR}-09</div>
<p>电子海图渲染开发的两件日常速查：<a href="#sec-sym">符号图库</a>按 INT 1 图式编号组织、附中文与对应 S-57 对象；<a href="#sec-color">颜色令牌表</a>把五套调色板并排对比，点色块即复制 HEX。<strong>仅供开发参考，正式生产请以 IHO 原始出版物为准。</strong></p>

<h2 id="sec-sym" class="sec-anchor">符号图库（INT 1 图式 · 常用）</h2>
<div class="sym-section">
<div class="sym-bar">
<span class="search"><input id="sym-q" class="search-input" type="search" placeholder="过滤：如 Q130 / 沉船 / wreck / WRECKS …" aria-label="过滤符号"></span>
<span class="cat-pills">${catPills}</span>
<span class="sym-count panel-desc">显示 <span id="sym-count">${syms.length}</span> / ${syms.length} 个</span>
</div>
<div class="sym-grid" id="sym-grid">
${symCards}
</div>
</div>
<p class="panel-desc">符号图为 INT 1 纸海图风格的再绘制（许可见页脚），与 ECDIS 屏显符号形状一致、配色细节或有差异；「对应对象」为该符号最常用的 S-57 对象。符号含义中文为编者译注。</p>

<h2 id="sec-color" class="sec-anchor">颜色令牌（S-52 调色板对比）</h2>
<div class="field-row" style="margin-bottom:10px">
<span class="panel-desc" style="margin:0;align-self:center">整包导出：</span>
${palNames.map((p) => `<button class="btn" type="button" data-palexp="${p}" style="padding:5px 12px">${PAL_ZH[p] || p} JSON</button>`).join('')}
<button class="btn" type="button" data-cssexp="DAY_BRIGHT" style="padding:5px 12px">CSS 变量（白昼）</button>
<span class="panel-desc" id="pal-exp-hint" style="margin:0"></span>
</div>
<div class="table-wrap">
<table class="data-table ctable">
<thead><tr><th>令牌</th><th>中文</th>${palHead}</tr></thead>
<tbody>
${palRows}
</tbody>
</table>
</div>
<p class="panel-desc">点击任一色块复制 HEX。ECDIS 量产实现须按 S-52 附录 2 做颜色校准与昼夜切换测试，此处为 PL 4.0 实现的参考屏显值。</p>
<p class="panel-desc">来源与许可：符号 SVG 来自 <a href="https://github.com/esri/nautical-chart-symbols" rel="noopener">Esri/nautical-chart-symbols</a>（Apache License 2.0）；颜色令牌值参考 IHO S-52 PresLib Ed 4.0 数字库。本页与其数据再分发遵循相应许可。</p>
</section>
<script>
(function(){
  var PALETTES = ${JSON.stringify(palettes)};
  var q=document.getElementById("sym-q"),pills=document.querySelectorAll(".cat-pills .pill"),
      cards=document.querySelectorAll("#sym-grid .sym-card"),cat="*";
  function copyText(t, btn, okLabel){
    var orig = btn.textContent;
    var done = function(){ btn.textContent = okLabel; setTimeout(function(){ btn.textContent = orig; }, 1200); };
    var fallback = function(){ var ta=document.createElement("textarea"); ta.value=t; ta.style.position="fixed"; ta.style.opacity="0"; document.body.appendChild(ta); ta.select(); try{document.execCommand("copy"); done();}catch(e){} document.body.removeChild(ta); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, fallback); else fallback();
  }
  document.addEventListener("click", function(ev){
    var pb = ev.target.closest("[data-palexp]");
    if (pb) {
      var p = pb.dataset.palexp;
      copyText(JSON.stringify(PALETTES[p], null, 2), pb, "已复制 ✓");
      var h = document.getElementById("pal-exp-hint");
      if (h) h.textContent = "已复制 " + p + " 全部 " + Object.keys(PALETTES[p]).length + " 个令牌（JSON）";
      return;
    }
    var cb = ev.target.closest("[data-cssexp]");
    if (cb) {
      var p2 = cb.dataset.cssexp;
      var lines = Object.keys(PALETTES[p2]).map(function(t){ return "--s52-" + t.toLowerCase() + ": " + PALETTES[p2][t] + ";"; });
      copyText(":root {\\n  " + lines.join("\\n  ") + "\\n}", cb, "已复制 ✓");
      var h2 = document.getElementById("pal-exp-hint");
      if (h2) h2.textContent = "已复制 CSS 变量（" + p2 + "，--s52- 前缀）";
    }
  });
  function apply(){var k=(q.value||"").trim().toLowerCase(),n=0;
    cards.forEach(function(c){
      var ok=(cat==="*"||c.dataset.cat===cat)&&(!k||c.dataset.s.indexOf(k)>=0);
      c.classList.toggle("hidden",!ok);if(ok)n++;
    });
    document.getElementById("sym-count").textContent=n;
  }
  if(q)q.addEventListener("input",apply);
  pills.forEach(function(p){p.addEventListener("click",function(){
    pills.forEach(function(x){x.classList.toggle("on",x===p)});cat=p.dataset.cat;apply();
  })});
  document.querySelectorAll(".pal-swatch").forEach(function(b){b.addEventListener("click",function(){
    var t=this,hex=t.dataset.hex;
    var done=function(){t.classList.add("copied");setTimeout(function(){t.classList.remove("copied")},900)};
    var fallback=function(){
      var ta=document.createElement("textarea");ta.value=hex;
      ta.style.position="fixed";ta.style.opacity="0";
      document.body.appendChild(ta);ta.select();
      try{if(document.execCommand("copy"))done()}catch(e){}
      document.body.removeChild(ta);
    };
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(hex).then(done,fallback);
    }else fallback();
  })});
})();
</script>`;
  fs.writeFileSync(path.join(OUT_DIR, 's52.html'), layout('S-52 颜色与符号速查', 'S-52 在线速查：五套标准调色板（白昼/黄昏/夜间）63 个颜色令牌屏显值，166 个 INT 1 图式常用海图符号中文图库，支持实时过滤。', s52Body, 'website', `${CFG.siteUrl}/s52.html`, true));
}

/* ---------------- S-100 要素目录解析器 ---------------- */
if (fs.existsSync(path.join(ROOT, 'assets', 's100-fc', 's101-fc-2.0.0.xml'))) {
  const fcBody = `<section class="post tool-page">
<h1 class="post-title">S-100 要素目录解析器</h1>
<div class="post-meta">纯浏览器解析，文件不出本机 · 内置样本：IHO S-101 Feature Catalogue 2.0.0 · 支持上传任意 S-100 产品的 FC XML</div>
<p>把 S-100 要素目录（FC）XML 拖进来或上传，即刻得到可搜索的要素类型 / 信息类型 / 属性 / 枚举值 / 关联全景。做 S-101 解析器和 ECDIS 校验时，这就是你的离线字典。</p>
<p class="toolbar"><span class="btn file-btn">上传目录 XML<input type="file" id="fc-file" accept=".xml,text/xml" hidden></span><button id="fc-sample" class="btn" type="button">加载内置 S-101 样本</button><span id="fc-status" class="panel-desc">正在加载内置样本…</span></p>
<div id="fc-stats" class="fc-stats hidden"></div>
<p class="toolbar cat-pills hidden" id="fc-tabs">
<button class="pill on" data-tab="ft" type="button">要素类型</button><button class="pill" data-tab="it" type="button">信息类型</button><button class="pill" data-tab="attr" type="button">属性</button><button class="pill" data-tab="assoc" type="button">关联</button>
</p>
<p class="toolbar hidden" id="fc-searchbar"><span class="search"><input id="fc-q" class="search-input" type="search" placeholder="过滤：如 DEPARE / Anchorage / 深度…" aria-label="过滤目录"></span><span class="panel-desc" style="margin:0">命中 <span id="fc-count">0</span> 条 · 点击行展开明细</span><button id="fc-csv" class="btn" type="button" style="padding:5px 12px">导出 CSV</button></p>
<div class="table-wrap hidden" id="fc-tablewrap"><table class="data-table"><thead id="fc-head"></thead><tbody id="fc-body"></tbody></table></div>
<p class="panel-desc hidden" id="fc-foot">解析在你的浏览器本地完成，文件不会上传到任何服务器。内置样本为 IHO S-101 Feature Catalogue 2.0.0（2024-10-16），版权归 IHO，仅作开发参考。支持把目录 XML 直接拖到页面任意位置上传。</p>
</section>
<script>
(function(){
  var FC = null;
  function kids(el, name){ var out=[]; for (var i=0;i<el.children.length;i++){ var c=el.children[i]; if (c.localName===name) out.push(c); } return out; }
  function kid(el, name){ var a=kids(el,name); return a.length?a[0]:null; }
  function txt(el, name){ var c=kid(el,name); return c?c.textContent.trim():''; }
  function deep(el, name){ var out=[]; for (var i=0;i<el.children.length;i++){ var c=el.children[i]; if (c.localName===name) out.push(c); out=out.concat(deep(c,name)); } return out; }
  function parseFC(text){
    var doc = new DOMParser().parseFromString(text, 'text/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('XML 解析失败：不是合法的 XML 文件');
    var all = doc.getElementsByTagName('*'), b = {};
    for (var i=0;i<all.length;i++){ var ln = all[i].localName; (b[ln]=b[ln]||[]).push(all[i]); }
    function bindings(el){ return kids(el,'attributeBinding').map(function(ab){
      var ref='', m=deep(ab,'lower')[0], mu=deep(ab,'upper')[0];
      var attrEl = kids(ab,'attribute')[0] || kids(ab,'complexAttribute')[0];
      if (attrEl) ref = attrEl.getAttribute('ref')||'';
      var pv = deep(ab,'permittedValues')[0], pvs = pv ? [].slice.call(pv.children).map(function(v){return v.textContent.trim()}) : [];
      var lower = m?m.textContent.trim():'0', upper = mu?mu.textContent.trim():'1';
      if (mu && mu.getAttribute('infinite')==='true') upper = '*';
      return {ref:ref, mult:lower+'..'+upper, pvs:pvs};
    }); }
    function infoBindings(el){ return kids(el,'informationBinding').map(function(ib){
      var itEl = kids(ib,'informationType')[0];
      var mu=deep(ib,'lower')[0], muu=deep(ib,'upper')[0];
      return {ref: itEl?(itEl.getAttribute('ref')||''):'', role: ib.getAttribute('roleType')||'', mult:(mu?mu.textContent.trim():'0')+'..'+(muu?muu.textContent.trim():'1')};
    }); }
    function listed(el){ return deep(el,'listedValue').map(function(lv){ return {code:(kid(lv,'code')?kid(lv,'code').textContent.trim():''), def:(kid(lv,'definition')?kid(lv,'definition').textContent.trim():''), label:(kid(lv,'label')?kid(lv,'label').textContent.trim():'')}; }); }
    function typeOf(el){ return { name:txt(el,'name'), def:txt(el,'definition'), code:txt(el,'code'), alias:txt(el,'alias'), abstract:el.getAttribute('isAbstract')==='true', clause:(function(){var dr=kid(el,'definitionReference'); return dr?(kid(dr,'sourceIdentifier')?kid(dr,'sourceIdentifier').textContent.trim():''):''})(), attrs:bindings(el), infos:infoBindings(el) }; }
    var fc = { featureTypes: (b['S100_FC_FeatureType']||[]).map(typeOf),
      informationTypes: (b['S100_FC_InformationType']||[]).map(typeOf),
      simple: (b['S100_FC_SimpleAttribute']||[]).map(function(el){ return { name:txt(el,'name'), def:txt(el,'definition'), code:txt(el,'code'), alias:txt(el,'alias'), vt:txt(el,'valueType'), values:listed(el) }; }),
      complex: (b['S100_FC_ComplexAttribute']||[]).map(function(el){ return { name:txt(el,'name'), def:txt(el,'definition'), code:txt(el,'code'), alias:txt(el,'alias'), attrs:bindings(el) }; }),
      assoc: (b['S100_FC_FeatureAssociation']||[]).map(function(el){ return { name:txt(el,'name'), def:txt(el,'definition'), code:txt(el,'code'), roles:[].slice.call(el.children).filter(function(c){return c.localName==='role'}).map(function(r){return r.getAttribute('ref')||''}) }; }),
      roles: (b['S100_FC_Role']||[]).map(function(el){ return { code:txt(el,'code'), name:txt(el,'name'), type:txt(el,'roleType'), members:deep(el,'member').map(function(m){return m.getAttribute('ref')||''}) }; })
    };
    if (!fc.featureTypes.length && !fc.simple.length) throw new Error('没有找到 FC 内容：确认这是 S-100 要素目录（FC）XML');
    return fc;
  }
  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function render(){
    var ft=FC.featureTypes.length, it=FC.informationTypes.length, sa=FC.simple.length, ca=FC.complex.length, as=FC.assoc.length;
    var lv=0; FC.simple.forEach(function(a){lv+=a.values.length});
    var chips=[['要素类型',ft],['信息类型',it],['简单属性',sa],['复杂属性',ca],['关联',as],['枚举值',lv]];
    document.getElementById('fc-stats').innerHTML = chips.map(function(c){return '<div class="pal-card fc-stat"><div class="fc-num">'+c[1]+'</div><div class="pal-zh">'+c[0]+'</div></div>'}).join('');
    ['fc-stats','fc-tabs','fc-searchbar','fc-tablewrap','fc-foot'].forEach(function(id){document.getElementById(id).classList.remove('hidden')});
    applyTab();
  }
  var TAB='ft', Q='';
  function multCls(m){ return m.indexOf('0')===0 ? 'fc-opt' : 'fc-req'; }
  function applyTab(){
    var head=document.getElementById('fc-head'), body=document.getElementById('fc-body'), q=Q.toLowerCase();
    function hit(o){ if (!q) return true; var s=[o.code,o.alias,o.name,o.def].concat((o.attrs||[]).map(function(a){return a.ref})).concat((o.infos||[]).map(function(a){return a.ref})).join(' ').toLowerCase(); return s.indexOf(q)>=0; }
    var rows='';
    if (TAB==='ft' || TAB==='it') {
      var list=(TAB==='ft'?FC.featureTypes:FC.informationTypes).filter(hit);
      head.innerHTML='<tr><th>编码</th><th>S-57 别名</th><th>名称</th><th>属性绑定</th><th>信息绑定</th></tr>';
      rows=list.map(function(o){
        var det='<div class="fc-def">'+esc(o.def||'(无定义)')+(o.clause?'<span class="sym-obj">DCEG '+esc(o.clause)+'</span>':'')+'</div>'
          + (o.abstract?'<p class="panel-desc">抽象类型</p>':'')
          + (o.attrs.length?'<p class="panel-desc"><strong>属性绑定</strong></p><ul class="fc-list">'+o.attrs.map(function(a){var pvs=a.pvs.length?' <span class=fc-opt>允许值: '+esc(a.pvs.join(' / '))+'</span>':''; return '<li><span class="fc-link" data-attr="'+esc(a.ref)+'"><code>'+esc(a.ref)+'</code></span> <span class="'+multCls(a.mult)+'">'+esc(a.mult)+'</span>'+pvs+'<span class="fc-go">查定义→</span></li>'}).join('')+'</ul>':'')
          + (o.infos.length?'<p class="panel-desc"><strong>信息绑定</strong></p><ul class="fc-list">'+o.infos.map(function(a){return '<li><code>'+esc(a.ref)+'</code> <span class="'+multCls(a.mult)+'">'+esc(a.mult)+'</span> '+(a.role?esc(a.role):'')+'</li>'}).join('')+'</ul>':'');
        return '<tr class="fc-row" data-det="'+esc(det)+'"><td class="c-code"><strong>'+esc(o.code)+'</strong></td><td>'+(o.alias?'<a href="s57-s101.html?q='+encodeURIComponent(o.alias)+'" title="在 S-57 ↔ S-101 对照表中查看 '+esc(o.alias)+'">'+esc(o.alias)+'</a>':'—')+'</td><td>'+esc(o.name)+'</td><td>'+o.attrs.length+'</td><td>'+o.infos.length+'</td></tr>';
      }).join('');
      document.getElementById('fc-count').textContent=list.length;
    } else if (TAB==='attr') {
      var list=FC.simple.filter(hit).map(function(o){return {kind:'simple', o:o}}).concat(FC.complex.filter(hit).map(function(o){return {kind:'complex', o:o}}));
      head.innerHTML='<tr><th>编码</th><th>S-57 别名</th><th>名称</th><th>类型</th><th>枚举值</th></tr>';
      rows=list.map(function(w){
        var o=w.o;
        var det='<div class="fc-def">'+esc(o.def||'(无定义)')+'</div>';
        if (w.kind==='complex') det+=o.attrs.length?'<ul class="fc-list">'+o.attrs.map(function(a){return '<li><code>'+esc(a.ref)+'</code> <span class="'+multCls(a.mult)+'">'+esc(a.mult)+'</span></li>'}).join('')+'</ul>':'';
        if (w.kind==='simple' && o.values.length) det+='<p class="panel-desc"><strong>枚举值（'+o.values.length+'）</strong></p><ul class="fc-list">'+o.values.map(function(v){return '<li><code>'+esc(v.code)+'</code> '+esc(v.label||v.def||'')+'</li>'}).join('')+'</ul>';
        return '<tr class="fc-row" data-det="'+esc(det)+'"><td class="c-code"><strong>'+esc(o.code)+'</strong></td><td>'+esc(o.alias||'—')+'</td><td>'+esc(o.name)+'</td><td>'+(w.kind==='complex'?'复杂':esc(o.vt||'—'))+'</td><td>'+(w.kind==='simple'?o.values.length:'—')+'</td></tr>';
      }).join('');
      document.getElementById('fc-count').textContent=list.length;
    } else {
      var list=FC.assoc.filter(hit);
      head.innerHTML='<tr><th>编码</th><th>名称</th><th>角色</th></tr>';
      rows=list.map(function(o){
        var members=[];
        o.roles.forEach(function(rc){ var role=FC.roles.filter(function(x){return x.code===rc})[0]; if(role) members.push({rc:rc, role:role}); });
        var det='<div class="fc-def">'+esc(o.def||'')+'</div>'+(members.length?'<ul class="fc-list">'+members.map(function(m){return '<li><code>'+esc(m.rc)+'</code> '+esc(m.role.type||'')+' ← '+m.role.members.map(esc).join(', ')+'</li>'}).join('')+'</ul>':'');
        return '<tr class="fc-row" data-det="'+esc(det)+'"><td class="c-code"><strong>'+esc(o.code)+'</strong></td><td>'+esc(o.name)+'</td><td>'+o.roles.map(esc).join(' ↔ ')+'</td></tr>';
      }).join('');
      document.getElementById('fc-count').textContent=list.length;
    }
    body.innerHTML=rows || '<tr><td colspan="5" class="not-conv">无匹配</td></tr>';
  }
  document.getElementById('fc-tabs').addEventListener('click', function(ev){
    var p = ev.target.closest('.pill'); if (!p) return;
    [].slice.call(document.querySelectorAll('#fc-tabs .pill')).forEach(function(x){x.classList.toggle('on', x===p)});
    TAB = p.dataset.tab; applyTab();
  });
  document.getElementById('fc-q').addEventListener('input', function(){ Q=this.value; applyTab(); });
  // URL 深链：fc.html?q=ANCH 直接预填过滤
  try { var upq = new URLSearchParams(location.search).get('q'); if (upq) { document.getElementById('fc-q').value = upq; Q = upq.toLowerCase(); } } catch(e) {}
  document.getElementById('fc-csv').addEventListener('click', function(){
    var lines = [];
    var head = Array.prototype.map.call(document.querySelectorAll('#fc-head th'), function(th){ return th.textContent.trim(); });
    lines.push(head.join(','));
    document.querySelectorAll('#fc-body tr').forEach(function(tr){
      var tds = Array.prototype.map.call(tr.cells, function(td){ var t = td.textContent.trim().replace(/\\s+/g, ' '); return '"' + t.replace(/"/g, '""') + '"'; });
      lines.push(tds.join(','));
    });
    var blob = new Blob(["\\ufeff" + lines.join("\\r\\n")], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 's100-fc-' + TAB + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 3000);
  });
  function jumpAttr(code){
    TAB='attr';
    [].slice.call(document.querySelectorAll('#fc-tabs .pill')).forEach(function(x){x.classList.toggle('on', x.dataset.tab==='attr')});
    var si=document.getElementById('fc-q'); si.value=code; Q=code.toLowerCase(); applyTab();
    var tr=document.querySelector('#fc-body .fc-row');
    if (tr){ tr.click(); }
  }
  document.getElementById('fc-body').addEventListener('click', function(ev){
    var lk = ev.target.closest('.fc-link');
    if (lk) { ev.stopPropagation(); jumpAttr(lk.getAttribute('data-attr')); return; }
    var tr = ev.target.closest('.fc-row'); if (!tr) return;
    var next = tr.nextElementSibling;
    if (next && next.classList.contains('fc-detail')) { next.remove(); return; }
    [].slice.call(document.querySelectorAll('.fc-detail')).forEach(function(x){x.remove()});
    var det = tr.getAttribute('data-det');
    var nCols = tr.children.length;
    tr.insertAdjacentHTML('afterend', '<tr class="fc-detail"><td colspan="'+nCols+'">'+det+'</td></tr>');
  });
  document.getElementById('fc-file').addEventListener('change', function(){
    var f = this.files[0]; if (!f) return;
    var rd = new FileReader();
    document.getElementById('fc-status').textContent = '解析中…';
    rd.onload = function(){ try { FC = parseFC(rd.result); document.getElementById('fc-status').textContent = '已加载：' + f.name; render(); } catch(err){ document.getElementById('fc-status').textContent = err.message; } };
    rd.readAsText(f);
  });
  ['dragover','dragenter'].forEach(function(t){ document.body.addEventListener(t, function(e){ e.preventDefault(); }); });
  document.body.addEventListener('drop', function(e){
    e.preventDefault();
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    var rd = new FileReader();
    document.getElementById('fc-status').textContent = '解析中…';
    rd.onload = function(){ try { FC = parseFC(rd.result); document.getElementById('fc-status').textContent = '已加载：' + f.name; render(); } catch(err){ document.getElementById('fc-status').textContent = err.message; } };
    rd.readAsText(f);
  });
  document.getElementById('fc-sample').addEventListener('click', loadSample);
  function loadSample(){
    document.getElementById('fc-status').textContent = '加载内置样本中…（约 2MB）';
    fetch('assets/s100-fc/s101-fc-2.0.0.xml').then(function(r){return r.text()}).then(function(t){ FC = parseFC(t); document.getElementById('fc-status').textContent = '已加载内置样本：IHO S-101 FC 2.0.0'; render(); }).catch(function(e){ document.getElementById('fc-status').textContent = '样本加载失败：' + e.message; });
  }
  loadSample();
})();
</script>`;
  fs.writeFileSync(path.join(OUT_DIR, 'fc.html'), layout('S-100 要素目录解析器', 'S-100 要素目录（FC）XML 在线解析器：上传或加载 S-101 要素目录，即时浏览 190 个要素类型、属性绑定、枚举值与关联关系，纯浏览器本地解析。', fcBody, 'website', `${CFG.siteUrl}/fc.html`, true));
}

/* ---------------- S-100 图示表达解析器 ---------------- */
if (fs.existsSync(path.join(ROOT, 'assets', 's100-pc', 'PortrayalCatalog_portrayal_catalogue.xml'))) {
  const pcAssetDir = path.join(ROOT, 'assets', 's100-pc');
  const PC_STYLES = fs.readdirSync(pcAssetDir).filter(function(f){ return f.indexOf('PortrayalCatalog_LineStyles_') === 0; }).sort();
  const PC_AREAS = fs.readdirSync(pcAssetDir).filter(function(f){ return f.indexOf('PortrayalCatalog_AreaFills_') === 0; }).sort();
  const pcBody = `<section class="post tool-page">
<h1 class="post-title">S-100 图示表达解析器</h1>
<div class="post-meta">纯浏览器解析，文件不出本机 · 内置样本：IHO S-101 Portrayal Catalogue 2.0.0（符号注册表 + 颜色配置）· 支持上传目录/颜色配置/告警目录 XML</div>
<p>解析 S-100 图示表达目录（PC）分发件：符号注册表、视图组图层、样式表清单一览，颜色配置直接渲染成 Day / Dusk / Night 三栏对照色表。做 S-101 显示端时对着它查符号与颜色。</p>
<p class="toolbar"><span class="btn file-btn">上传表达目录 XML<input type="file" id="pc-file" accept=".xml,text/xml" hidden></span><button id="pc-sample" class="btn" type="button">重新加载内置样本</button><span id="pc-status" class="panel-desc">正在加载内置样本…</span></p>
<div id="pc-stats" class="fc-stats hidden"></div>
<p class="toolbar cat-pills hidden" id="pc-tabs">
<button class="pill on" data-tab="idx" type="button">目录索引</button><button class="pill" data-tab="sym" type="button">符号注册表</button><button class="pill" data-tab="vgl" type="button">视图组</button><button class="pill" data-tab="col" type="button">颜色配置</button><button class="pill" data-tab="pat" type="button">线型 / 填充</button><button class="pill" data-tab="alert" type="button">告警目录</button>
</p>
<p class="toolbar hidden" id="pc-searchbar"><span class="search"><input id="pc-q" class="search-input" type="search" placeholder="过滤：如 ACHARE /  anchorage / 颜色令牌…" aria-label="过滤"></span><span class="panel-desc" style="margin:0">命中 <span id="pc-count">0</span> 条</span><span id="pat-palsw" class="hidden" style="margin-left:6px"></span></p>
<div class="table-wrap hidden" id="pc-tablewrap"><table class="data-table"><thead id="pc-head"></thead><tbody id="pc-body"></tbody></table></div>
<p class="panel-desc hidden" id="pc-foot">Look-up 规则文件不在公开分发件内，本工具解析目录索引、符号注册表与颜色配置。内置样本版权归 IHO，仅作开发参考；解析在浏览器本地完成。支持把 XML 直接拖到页面任意位置上传。</p>
</section>
<script>var PC_FILES = ${JSON.stringify(PC_STYLES.concat(PC_AREAS))};</script>
<script>
(function(){
  var IDX=null, CP=null, AL=null;
  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function kids(el,name){var o=[];for(var i=0;i<el.children.length;i++){var c=el.children[i];if(c.localName===name)o.push(c)}return o}
  function kid(el,name){var a=kids(el,name);return a.length?a[0]:null}
  function txt(el,name){var c=kid(el,name);return c?c.textContent.trim():''}
  function deep(el,name){var o=[];for(var i=0;i<el.children.length;i++){var c=el.children[i];if(c.localName===name)o.push(c);o=o.concat(deep(c,name))}return o}
  function parseAny(text){
    var doc=new DOMParser().parseFromString(text,'text/xml');
    if(doc.getElementsByTagName('parsererror').length) throw new Error('XML 解析失败');
    var root=doc.documentElement.localName;
    if(root==='portrayalCatalog'){ IDX=parseIdx(doc); return 'index'; }
    if(root==='colorProfile'){ CP=parseCp(doc); return 'colors'; }
    if(root.indexOf('Alert')>=0 || root.indexOf('alert')>=0){ AL=parseAlert(doc); return 'alerts'; }
    throw new Error('未知根元素：'+root+'（支持 portrayalCatalog / colorProfile / 告警目录）');
  }
  function parseIdx(doc){
    var sym={}; [].slice.call(doc.getElementsByTagName('*')).forEach(function(el){ if(el.localName==='symbol'){ var d=el.getElementsByTagName('*'); var desc=''; for(var i=0;i<d.length;i++){ if(d[i].localName==='description'){desc=d[i].textContent.trim();break} } sym[el.getAttribute('id')||'']=desc; } });
    var vgl=[]; [].slice.call(doc.getElementsByTagName('*')).forEach(function(el){ if(el.localName==='viewingGroupLayer'){ vgl.push({id:el.getAttribute('id')||'', name:txt(el,'name'), groups:deep(el,'viewingGroup').map(function(g){return g.textContent.trim()})}); } });
    var ss=[]; [].slice.call(doc.getElementsByTagName('*')).forEach(function(el){ if(el.localName==='styleSheet'){ ss.push({name:txt(el,'name')||el.getAttribute('id')||'', files:[].slice.call(el.children).filter(function(c){return c.localName==='fileName'||c.localName==='file'}).map(function(c){return c.textContent.trim()})}); } });
    return {symbols:sym, vgl:vgl, ss:ss};
  }
  function parseCp(doc){
    var names={}; [].slice.call(doc.getElementsByTagName('*')).forEach(function(el){ if(el.localName==='color'){ names[el.getAttribute('token')||'']={name:txt(el,'name'), desc:(kid(el,'description')?kid(el,'description').textContent.trim():'')} } });
    var pal={}; [].slice.call(doc.getElementsByTagName('*')).forEach(function(el){ if(el.localName==='palette'){ var pn=el.getAttribute('name')||''; pal[pn]=pal[pn]||{}; [].slice.call(el.children).forEach(function(item){ if(item.localName!=='item') return; var tok=item.getAttribute('token'); var s=kid(item,'srgb'); if(s){ var r=+txt(s,'red'),g=+txt(s,'green'),b=+txt(s,'blue'); pal[pn][tok]='#'+[r,g,b].map(function(v){return ('0'+Math.max(0,Math.min(255,v)).toString(16)).slice(-2)}).join(''); } }) } });
    var tokens=Object.keys(names); Object.keys(pal).forEach(function(p){ Object.keys(pal[p]).forEach(function(t){ if(tokens.indexOf(t)<0) tokens.push(t); }) });
    return {names:names, pal:pal, tokens:tokens};
  }
  function parseAlert(doc){ return [].slice.call(doc.getElementsByTagName('*')).filter(function(el){return el.localName==='alert'}).map(function(e){return {id:e.getAttribute('id')||'', name:txt(e,'name'), desc:(kid(e,'description')?kid(e,'description').textContent.trim():'')}}); }
  var TAB='idx', Q='', PATPAL='Day';
  function applyTab(){
    var psw = document.getElementById('pat-palsw');
    if (psw && TAB !== 'pat') psw.classList.add('hidden');
    var head=document.getElementById('pc-head'), body=document.getElementById('pc-body');
    var q=(Q||'').toLowerCase();
    function hit(){ return true; }
    if (TAB==='idx') {
      var files=[['符号注册表',Object.keys(IDX.symbols).length],['视图组图层',IDX.vgl.length],['样式表',IDX.ss.length]];
      document.getElementById('pc-stats').innerHTML=files.map(function(c){return '<div class="pal-card fc-stat"><div class="fc-num">'+c[1]+'</div><div class="pal-zh">'+c[0]+'</div></div>'}).join('');
      var syms=Object.keys(IDX.symbols).filter(function(k){return !q || (k+' '+IDX.symbols[k]).toLowerCase().indexOf(q)>=0});
      head.innerHTML='<tr><th>符号 ID</th><th>描述</th></tr>';
      body.innerHTML=syms.map(function(k){return '<tr><td class="c-code"><strong>'+esc(k)+'</strong></td><td>'+esc(IDX.symbols[k])+'</td></tr>'}).join('') || '<tr><td colspan="2" class="not-conv">无匹配</td></tr>';
      document.getElementById('pc-count').textContent=syms.length;
    } else if (TAB==='vgl' && IDX) {
      var list=IDX.vgl.filter(function(v){return !q || (v.id+' '+v.name+' '+v.groups.join(' ')).toLowerCase().indexOf(q)>=0});
      head.innerHTML='<tr><th>图层</th><th>名称</th><th>视图组</th></tr>';
      body.innerHTML=list.map(function(v){return '<tr><td class="c-code"><strong>'+esc(v.id)+'</strong></td><td>'+esc(v.name||'')+'</td><td class="fc-opt">'+esc(v.groups.join(', '))+'</td></tr>'}).join('') || '<tr><td colspan="3" class="not-conv">无匹配</td></tr>';
      document.getElementById('pc-count').textContent=list.length;
    } else if (TAB==='col' && CP) {
      var pal=CP.pal, pn=Object.keys(pal);
      var toks=CP.tokens.filter(function(t){return !q || (t+' '+(CP.names[t]?CP.names[t].name+' '+CP.names[t].desc:'')).toLowerCase().indexOf(q)>=0});
      head.innerHTML='<tr><th>令牌</th><th>名称</th>'+pn.map(function(p){return '<th>'+esc(p)+'</th>'}).join('')+'</tr>';
      body.innerHTML=toks.map(function(t){
        var n=CP.names[t]||{};
        return '<tr><td class="c-code"><strong>'+esc(t)+'</strong></td><td class="pal-zh-cell">'+esc(n.name||'')+'</td>'+pn.map(function(p){
          var hex=(pal[p]&&pal[p][t])||'';
          return '<td>'+(hex?'<span class="pal-swatch" data-hex="'+hex+'" title="点击复制 '+hex+'"><span class="chip" style="background:'+hex+'"></span><span class="hex">'+hex+'</span></span>':'—')+'</td>';
        }).join('')+'</tr>';
      }).join('');
      document.getElementById('pc-count').textContent=toks.length;
    } else if (TAB==='alert' && AL) {
      var list=AL.filter(function(a){return !q || (a.id+' '+a.name+' '+a.desc).toLowerCase().indexOf(q)>=0});
      head.innerHTML='<tr><th>ID</th><th>名称</th><th>说明</th></tr>';
      body.innerHTML=list.map(function(a){return '<tr><td class="c-code"><strong>'+esc(a.id)+'</strong></td><td>'+esc(a.name)+'</td><td>'+esc(a.desc)+'</td></tr>'}).join('') || '<tr><td colspan="3" class="not-conv">无匹配</td></tr>';
      document.getElementById('pc-count').textContent=list.length;
    } else if (TAB==='pat') {
      if (!window.PAT) { loadPat(); return; }
      if (psw) { psw.classList.remove('hidden'); psw.innerHTML = ['Day','Dusk','Night'].map(function(pn){ return '<button class="pill'+(PATPAL===pn?' on':'')+'" data-pal="'+pn+'" type="button">'+pn+'</button>'; }).join(''); }
      var plist = window.PAT.list.filter(function(p2){ return !q || (p2.name+' '+p2.expo).toLowerCase().indexOf(q)>=0; });
      head.innerHTML='<tr><th>名称</th><th>类型</th><th>说明</th><th style="min-width:240px">预览</th></tr>';
      body.innerHTML=plist.map(function(p2){
        return '<tr><td class="c-code"><strong>'+esc(p2.name)+'</strong></td><td>'+(p2.kind==='line'?'线型':(p2.kind==='fill'?'面填充':'?'))+'</td><td class="fc-opt">'+esc(p2.expo)+'</td><td>'+(p2.kind==='line'?'<canvas class="pat-cv" data-f="'+esc(p2.file)+'" width="240" height="26" style="display:block"></canvas>':'<span class="fc-opt">符号平铺：'+esc(p2.sym||'—')+'</span>')+'</td></tr>';
      }).join('') || '<tr><td colspan="4" class="not-conv">无匹配</td></tr>';
      document.getElementById('pc-count').textContent=plist.length;
      plist.forEach(function(p2){ if(p2.kind==='line' && p2.parsed) drawLinePreview(document.querySelector('.pat-cv[data-f="'+p2.file+'"]'), p2.parsed); });
    } else {
      head.innerHTML=''; body.innerHTML='';
    }
  }
  document.getElementById('pc-tabs').addEventListener('click', function(ev){
    var p = ev.target.closest('.pill'); if (!p) return;
    [].slice.call(document.querySelectorAll('#pc-tabs .pill')).forEach(function(x){x.classList.toggle('on', x===p)});
    TAB = p.dataset.tab; applyTab();
  });
  document.addEventListener('click', function(ev){
    var b = ev.target.closest('[data-pal]'); if (!b) return;
    PATPAL = b.dataset.pal;
    [].slice.call(document.querySelectorAll('#pat-palsw [data-pal]')).forEach(function(x){ x.classList.toggle('on', x.dataset.pal === PATPAL); });
    document.querySelectorAll('.pat-cv[data-f]').forEach(function(cv2){
      var item = window.PAT && window.PAT.list.filter(function(p2){ return p2.file === cv2.dataset.f; })[0];
      if (item && item.parsed) drawLinePreview(cv2, item.parsed);
    });
  });
  document.getElementById('pc-q').addEventListener('input', function(){ Q=this.value; applyTab(); });
  document.getElementById('pc-tablewrap').addEventListener('click', function(ev){
    var sw = ev.target.closest('.pal-swatch'); if (!sw) return;
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(sw.dataset.hex);
    sw.classList.add('copied'); setTimeout(function(){sw.classList.remove('copied')}, 800);
  });
  document.getElementById('pc-file').addEventListener('change', function(){
    var f=this.files[0]; if(!f) return;
    var rd=new FileReader();
    document.getElementById('pc-status').textContent='解析中…';
    rd.onload=function(){ try { var kind=parseAny(rd.result); document.getElementById('pc-status').textContent='已加载：'+f.name+'（'+kind+'）'; showLoaded(kind); } catch(err){ document.getElementById('pc-status').textContent=err.message; } };
    rd.readAsText(f);
  });
  ['dragover','dragenter'].forEach(function(t){ document.body.addEventListener(t, function(e){ e.preventDefault(); }); });
  document.body.addEventListener('drop', function(e){
    e.preventDefault();
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    var rd = new FileReader();
    document.getElementById('pc-status').textContent = '解析中…';
    rd.onload = function(){ try { var kind = parseAny(rd.result); document.getElementById('pc-status').textContent = '已加载：' + f.name + '（' + kind + '）'; showLoaded(kind); } catch(err){ document.getElementById('pc-status').textContent = err.message; } };
    rd.readAsText(f);
  });
  function showLoaded(kind){
    ['pc-stats','pc-tabs','pc-searchbar','pc-tablewrap','pc-foot'].forEach(function(id){document.getElementById(id).classList.remove('hidden')});
    var map={index:'idx', colors:'col', alerts:'alert'};
    TAB=map[kind]||'idx';
    [].slice.call(document.querySelectorAll('#pc-tabs .pill')).forEach(function(x){x.classList.toggle('on', x.dataset.tab===TAB)});
    applyTab();
  }
  document.getElementById('pc-sample').addEventListener('click', loadSample);
  var PAT=null, PATPAL='Day';
  function drawLinePreview(cv, st){
    if (!cv || !st) return;
    var ctx = cv.getContext('2d');
    ctx.clearRect(0,0,cv.width,cv.height);
    var pal = (CP && CP.pal && (CP.pal[PATPAL] || CP.pal.Day)) || {};
    var hex = pal[st.color] || '#888888';
    var y = cv.height/2, W = cv.width, span = st.interval || 32, ppu = W/(span*1.15);
    ctx.strokeStyle = '#c9c5bb'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0,y+9); ctx.lineTo(W,y+9); ctx.stroke();
    ctx.strokeStyle = hex;
    ctx.lineWidth = Math.max(1.6, Math.min(5, st.width*2.2));
    ctx.lineCap = 'butt';
    var dashes = st.dashes.length ? st.dashes : [{start:0,length:span}];
    var reps = Math.ceil(W/(span*ppu)) + 1;
    for (var ri=0; ri<reps; ri++){
      for (var di=0; di<dashes.length; di++){
        var d0=dashes[di], x0=(d0.start+ri*span)*ppu, x1=(d0.start+ri*span+d0.length)*ppu;
        if (x1 < 0 || x0 > W) continue;
        ctx.beginPath(); ctx.moveTo(Math.max(0,x0), y); ctx.lineTo(Math.min(W,x1), y); ctx.stroke();
      }
    }
  }
  function parsePatText(txt2){
    var mh = txt2.match(/S100Meta name="([^"]+)" exposition="([^"]*)"/) || [];
    var out = { name: mh[1]||'', expo: mh[2]||'' };
    if (txt2.indexOf('lineStyle')>=0) {
      out.kind='line';
      out.interval = parseFloat((txt2.match(/<intervalLength>([0-9.]+)</)||[])[1]||'32') || 32;
      out.width = parseFloat((txt2.match(/<pen width="([0-9.]+)"/)||[])[1]||'0.3') || 0.3;
      out.color = (txt2.match(/<color>([A-Z0-9]+)<\\/color>/)||[])[1]||'';
      out.dashes = [];
      var dre = /<dash><start>([0-9.]+)<\\/start><length>([0-9.]+)<\\/length><\\/dash>/g, dm;
      while ((dm = dre.exec(txt2))) out.dashes.push({start:parseFloat(dm[1]), length:parseFloat(dm[2])});
    } else if (txt2.indexOf('symbolFill')>=0) {
      out.kind='fill';
      var sr = txt2.match(/<symbol reference="([^"]+)"/);
      out.sym = sr ? sr[1] : '';
    } else out.kind='?';
    return out;
  }
  function loadPat(){
    document.getElementById('pc-body').innerHTML = '<tr><td class="not-conv">加载 '+PC_FILES.length+' 个线型 / 填充文件中…</td></tr>';
    var jobs = PC_FILES.map(function(f2){
      return fetch('assets/s100-pc/'+f2).then(function(r){ return r.text(); }).then(function(t2){
        var p2 = parsePatText(t2);
        p2.file = f2;
        if (f2.indexOf('_LineStyles_')===0) p2.kind='line';
        else if (f2.indexOf('_AreaFills_')===0) p2.kind='fill';
        if (p2.kind==='line') p2.parsed = { interval: p2.interval, width: p2.width, color: p2.color, dashes: p2.dashes };
        return p2;
      }).catch(function(){ return {file:f2, name:f2.replace('PortrayalCatalog_LineStyles_','').replace('PortrayalCatalog_AreaFills_','').replace('.xml',''), expo:'', kind:'?'}; });
    });
    Promise.all(jobs).then(function(rs){
      rs.sort(function(a2,b2){ return a2.name<b2.name?-1:1; });
      window.PAT = { list: rs };
      applyTab();
    });
  }
  function loadSample(){
    document.getElementById('pc-status').textContent='加载内置样本中…';
    Promise.all([
      fetch('assets/s100-pc/PortrayalCatalog_portrayal_catalogue.xml').then(function(r){return r.text()}),
      fetch('assets/s100-pc/PortrayalCatalog_ColorProfiles_colorProfile.xml').then(function(r){return r.text()}),
      fetch('assets/s100-pc/PortrayalCatalog_AlertCatalog-S101.xml').then(function(r){return r.text()})
    ]).then(function(rs){ parseAny(rs[0]); parseAny(rs[1]); parseAny(rs[2]); document.getElementById('pc-status').textContent='已加载内置样本：IHO S-101 PC 2.0.0'; showLoaded('index'); }).catch(function(e){ document.getElementById('pc-status').textContent='样本加载失败：'+e.message; });
  }
  loadSample();
})();
</script>`;
  fs.writeFileSync(path.join(OUT_DIR, 'pc.html'), layout('S-100 图示表达解析器', 'S-100 图示表达目录（PC）XML 在线解析器：符号注册表、视图组图层、样式表清单与 S-101 颜色配置 Day/Dusk/Night 三栏对照色表，纯浏览器本地解析。', pcBody, 'website', `${CFG.siteUrl}/pc.html`, true));
}

/* ---------------- HDF5 / S-102 数据解析器 ---------------- */
const H5_PAGE = `<section class="post tool-page">
<h1 class="post-title">HDF5 / S-100 网格解析器</h1>
<div class="post-meta">纯浏览器解析（h5wasm，NIST）· 文件不出本机 · 内置样本：NOAA S-102 官方测试数据集（公有领域）</div>
<p>S-100 系列网格产品（S-102 水深 / S-111 表层流场）是 HDF5 格式。把 .h5 文件拖进来：除结构树、属性与数值统计外，识别到标准结构时会自动渲染<strong>热力图</strong>——S-102 按水深着色（区分干出与填充值），S-111 按流速着色并叠加流向箭头，多时序帧可下拉切换，点选网格任意位置读取单元数值。</p>
<p class="toolbar"><span class="btn file-btn">上传 .h5 文件<input type="file" id="h5-file" accept=".h5,.hdf5" hidden></span><button id="h5-sample" class="btn" type="button">加载内置 S-102 样本</button><button id="h5-sample111" class="btn" type="button">加载内置 S-111 样本</button><span id="h5-status" class="panel-desc">引擎加载中…</span></p>
<div id="h5-out" class="hidden"><div id="h5-stats" class="fc-stats"></div><div id="h5-s102"></div><div id="h5-tree" class="h5-tree"></div></div>
<p class="panel-desc hidden" id="h5-foot">解析由 WebAssembly 版 HDF5（h5wasm，NIST 出品）在你的浏览器本地完成，文件不会上传。超大数据集（元素数超 400 万）只显示形状与属性，不展开数值。也可把 .h5 文件直接拖到页面任意位置上传。</p>
</section>
<script src="assets/h5wasm/h5wasm.js"></script>
<script>
(function(){
  var H5G = window.h5wasm || null, READY = null;
  function boot(){
    if (READY) return READY;
    if (!H5G) { H5G = window.h5wasm || null; if (!H5G) { return Promise.reject(new Error('引擎脚本未加载')); } }
    READY = (H5G.ready ? H5G.ready : Promise.resolve());
    return READY;
  }
  var el = function(id){return document.getElementById(id)};
  function stat(html){ el('h5-stats').innerHTML = html; }
  function status(t){ el('h5-status').textContent = t; }
  function fmtN(v){ return (typeof v === 'number') ? (Math.abs(v) >= 100000 ? v.toExponential(3) : (Math.round(v*1000)/1000)) : v; }
  function attrsOf(obj){
    var out = {};
    try { var a = obj.attrs || {}; Object.keys(a).forEach(function(k){ try { var v = a[k]; out[k] = (typeof v === 'object' && v !== null) ? JSON.stringify(v).slice(0,80) : String(v).slice(0,80); } catch(e) {} }); } catch(e) {}
    return out;
  }
  function peek(obj){
    try {
      var shape = obj.shape || [];
      var total = shape.length ? shape.reduce(function(a,c){return a*c},1) : 1;
      if (!total || total > 200) return '';
      var v = obj.value;
      function flat(a){ var o=[]; (function r(x){ if (o.length>=10 || x===null || x===undefined) return; if (Array.isArray(x) || x.length !== undefined && typeof x !== 'string') { for (var i=0;i<x.length && o.length<10;i++) r(x[i]); } else o.push(x); })(a); return o; }
      var flatv = [].concat(v).slice(0, 50);
      var vals = flat(flatv).slice(0, 10).map(function(x){ return typeof x === 'bigint' ? x.toString() : (typeof x === 'number' ? (Math.round(x*1000)/1000) : String(x)); });
      return vals.length ? vals.join(', ') : '';
    } catch(e) { return ''; }
  }
  function walk(gr, path, depth, out){
    if (depth > 6 || out.count > 400) { out.trunc = true; return; }
    var keys = [];
    try { keys = gr.keys(); } catch(e) { return; }
    keys.forEach(function(k){
      out.count++;
      if (out.count > 400) { out.trunc = true; return; }
      var p = path + '/' + k, obj = null;
      try { obj = gr.get(k); } catch(err) { out.rows.push({p:p, kind:'?', meta:'读取失败', depth:depth, attrs:{}}); return; }
      var isGroup = obj.constructor.name === 'Group' || (obj.keys && typeof obj.keys === 'function');
      if (isGroup) {
        out.rows.push({p:p, kind:'Group', meta:'组', depth:depth, attrs:attrsOf(obj)});
        walk(obj, p, depth+1, out);
      } else {
        var shape = (obj.shape || []).join('×') || '标量';
        var dtype = obj.dtype || '';
        var total = (obj.shape||[]).reduce(function(a,c){return a*c},1);
        out.rows.push({p:p, kind:'Dataset', meta:shape + ' · ' + dtype, depth:depth, attrs:attrsOf(obj), peek: total<=200 ? peek(obj) : ''});
      }
    });
  }
  function handle(buf, name){
    status('解析中…');
    boot().then(function(){
      try {
        H5G.FS.writeFile('up.h5', new Uint8Array(buf));
        var f = new H5G.File('up.h5', 'r');
        var out = {rows: [], count: 0, trunc: false};
        walk(f, '', 0, out);
        var s102 = findProduct(f);
        var stats = '<div class="pal-card fc-stat"><div class="fc-num">'+out.rows.filter(function(r){return r.kind==='Dataset'}).length+'</div><div class="pal-zh">数据集</div></div>'
          + '<div class="pal-card fc-stat"><div class="fc-num">'+out.rows.filter(function(r){return r.kind==='Group'}).length+'</div><div class="pal-zh">组</div></div>'
          + '<div class="pal-card fc-stat"><div class="fc-num">'+name+'</div><div class="pal-zh">文件</div></div>';
        el('h5-stats').innerHTML = stats;
        el('h5-s102').innerHTML = s102;
        if (PD) { drawProduct(); bindProbe(); }
        el('h5-tree').innerHTML = out.rows.map(function(r, i){
          var akeys = Object.keys(r.attrs||{});
          var hasDetail = akeys.length || r.peek;
          var det = hasDetail ? '<div class="h5-detail hidden" data-i="'+i+'">'+(akeys.length?'<strong>属性</strong><ul class="fc-list">'+akeys.map(function(k){return '<li><code>'+esc(k)+'</code> '+esc(r.attrs[k])+'</li>'}).join('')+'</ul>':'')+(r.peek?'<strong>数值预览</strong><div class="fc-opt">'+esc(r.peek)+'</div>':'')+'</div>' : '';
          return '<div class="h5-block"><div class="h5-row h5-'+r.kind.toLowerCase()+'" data-i="'+i+'" style="padding-left:'+(8+r.depth*18)+'px"><code>'+esc(r.p)+'</code><span class="h5-kind">'+r.kind+'</span><span class="fc-opt">'+esc(r.meta||'')+'</span>'+(hasDetail?'<span class="fc-go">详情</span>':'')+'</div>'+det+'</div>';
        }).join('') + (out.trunc ? '<div class="panel-desc">…结构过多，仅显示前 400 项</div>' : '');
        el('h5-out').classList.remove('hidden');
        el('h5-foot').classList.remove('hidden');
        status('解析完成：' + name);
        if (PD) { if (PREVF && PREVF !== f) { try { PREVF.close(); } catch(e) {} } PREVF = f; }
        else { try { f.close(); } catch(e) {} }
      } catch(err) { status('解析失败：' + err.message); }
    }).catch(function(e){ status('引擎错误：' + e.message); });
  }
  var PD = null, PREVF = null; // PD：识别到的 S-100 网格产品（含文件句柄，供时序帧切换复读）
  var DEPTH_STOPS = [[0,[155,232,245]],[0.45,[61,155,209]],[1,[18,62,107]]];
  var SPEED_STOPS = [[0,[234,246,255]],[0.5,[127,200,240]],[1,[10,42,85]]];
  function lerpStops(t, stops){
    if (!(t >= 0)) t = 0; if (t > 1) t = 1;
    for (var i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        var a = stops[i-1], b = stops[i], f = (t - a[0]) / ((b[0] - a[0]) || 1);
        return [Math.round(a[1][0]+(b[1][0]-a[1][0])*f), Math.round(a[1][1]+(b[1][1]-a[1][1])*f), Math.round(a[1][2]+(b[1][2]-a[1][2])*f)];
      }
    }
    return stops[stops.length-1][1];
  }
  function resolveGroup(f, p){ return p.split('/').filter(function(x){ return x; }).reduce(function(g, k){ return g.get(k); }, f); }
  function findProduct(f){
    try {
      var found = null;
      (function scan(gr, path, depth){
        if (depth > 6) return;
        var keys = []; try { keys = gr.keys(); } catch(e) { return; }
        keys.forEach(function(k){
          var p = path + '/' + k, obj = null;
          try { obj = gr.get(k); } catch(e) { return; }
          var isGroup = obj && obj.keys && typeof obj.keys === 'function';
          if (!isGroup) return;
          if (!found) {
            var m = p.match(/\\/(BathymetryCoverage|SurfaceCurrent|WaterLevel)(\\.\\d+)?$/i);
            if (m) found = { kind: /bathymetry/i.test(m[1]) ? 'S-102' : (/surfacecurrent/i.test(m[1]) ? 'S-111' : 'S-104'), base: p.replace(/\\.\\d+$/, ''), groups: [], extentText: '' };
          }
          if (found && p.indexOf(found.base) === 0) {
            if (/Group_F$/i.test(p)) {
              // Group_F 是要素元数据表：fillValue / uom 都以规范声明在此，优先级高于内置默认
              try {
                obj.keys().forEach(function(dn){
                  try {
                    var rows2 = obj.get(dn).value;
                    for (var ri = 0; ri < rows2.length; ri++) {
                      var rec = rows2[ri] || {};
                      var code = String(rec.code || rec.name || '');
                      if (/speed|depth|height/i.test(code)) {
                        var fv = parseFloat(String(rec.fillValue));
                        if (isFinite(fv)) found.fill = fv;
                        var um = String(rec['uom.name'] || '').trim();
                        if (um) found.uom = um;
                      }
                    }
                  } catch(e) {}
                });
              } catch(e) {}
            }
            if (/\\/extent$/i.test(p)) {
              try {
                var a = obj.attrs || {};
                function g2(n){ return a[n] !== undefined ? a[n] : (a[n.charAt(0).toUpperCase()+n.slice(1)] !== undefined ? a[n.charAt(0).toUpperCase()+n.slice(1)] : null); }
                var w = g2('westLon'), e2 = g2('eastLon'), s = g2('southLat'), n2 = g2('northLat');
                if (w !== null && n2 !== null && w !== '' && n2 !== '') found.extentText = '经度 ' + w + ' ~ ' + e2 + ' · 纬度 ' + s + ' ~ ' + n2;
              } catch(e) {}
            }
            if (/^Group/i.test(k)) {
              var vals = null; try { vals = obj.get('values'); } catch(e) {}
              if (vals && vals.shape && vals.shape.length === 2) found.groups.push({ name: k, path: p + '/values', rows: vals.shape[0], cols: vals.shape[1] });
            }
          }
          scan(obj, p, depth+1);
        });
      })(f, '', 0);
      if (!found || !found.groups.length) {
        return '<div class="panel-desc">未检测到 S-102 / S-111 标准网格结构（仅作一般 HDF5 解析；S-104 站点时序请直接展开结构树查看）。</div>';
      }
      var g0 = found.groups[0], kind = found.kind;
      var ds0 = resolveGroup(f, g0.path);
      var v0 = ds0.value;
      // h5wasm 对 (rows,cols) 数据集一律返回扁平数组：数值型是平铺的 TypedArray，复合型是 [分量0, 分量1, …] 小数组
      var n0 = g0.rows * g0.cols;
      var flat = v0.length === n0;
      var names = [];
      try {
        var dts = ds0.dtype;
        if (dts && typeof dts === 'object') {
          // h5wasm 复合 dtype 是对象/数组，字段名藏在每个分量的 name/code 属性里
          Object.keys(dts).forEach(function(k){
            var item = dts[k];
            var nm2 = null;
            if (Array.isArray(item)) nm2 = (typeof item[0] === 'string') ? item[0] : null;
            else if (item && typeof item === 'object') nm2 = item.name || item.code || item.label;
            else if (typeof item === 'string') { var m3 = item.match(/[A-Za-z_][A-Za-z0-9_]*/); nm2 = m3 ? m3[0] : null; if (nm2 && nm2.charAt(0) === '<') nm2 = null; }
            if (nm2 && names.indexOf(nm2) < 0) names.push(nm2);
          });
        } else {
          var dts2 = String(dts || '');
          var nm, re2 = /['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*[:,]/g;
          while ((nm = re2.exec(dts2))) { if (names.indexOf(nm[1]) < 0 && nm[1].charAt(0) !== '<') names.push(nm[1]); }
        }
      } catch(e) {}
      // 字段名仍为空时，探测首个复合单元（小数值数组）的分量数，退化为分量序号
      if (!names.length) {
        for (var pi = 0; pi < v0.length; pi++) {
          var pc = v0[pi];
          if (pc && typeof pc === 'object' && pc.length && typeof pc[0] === 'number') { for (var qi = 0; qi < pc.length; qi++) names.push('分量' + qi); break; }
        }
      }
      var isCompound = names.length > 0;
      var field = isCompound ? (names.filter(function(k){ return /depth|speed/i.test(k); })[0] || names[0]) : null;
      var extraField = isCompound ? (names.filter(function(k){ return k !== field; })[0] || null) : null;
      found.meta = { rows: g0.rows, cols: g0.cols, names: names, field: field, extraField: extraField, fieldIdx: isCompound ? names.indexOf(field) : 0, extraIdx: isCompound && extraField ? names.indexOf(extraField) : 1, f: f };
      if (!isFinite(found.fill)) found.fill = (kind === 'S-102') ? 1000000 : -9999;
      found.uomTxt = found.uom === 'knots' ? ' kn' : (found.uom ? ' ' + found.uom : (kind === 'S-102' ? ' m' : ''));
      PD = found;
      var line = '<div class="panel"><h2>' + kind + (kind === 'S-102' ? ' 水深表面' : ' 表层流场') + '识别成功</h2>';
      line += '<p class="panel-desc">数据集 <code>' + esc(g0.path) + '</code> · ' + g0.rows + '×' + g0.cols + ' 网格 · ' + (isCompound ? ('复合类型（' + esc((field || '分量0') + ' + ' + (extraField || '分量1')) + '）') : '数值类型') + '</p>';
      if (found.extentText) line += '<p class="panel-desc">地理范围：' + esc(found.extentText) + '</p>';
      if (found.groups.length > 1) {
        line += '<p class="panel-desc">时序帧（' + found.groups.length + '）：<select id="h5-gsel" class="select">' + found.groups.map(function(g, i){ return '<option value="' + i + '"' + (i ? '' : ' selected') + '>' + esc(g.name) + '</option>'; }).join('') + '</select></p>';
      }
      line += '<canvas id="h5-canvas" style="width:100%;max-width:860px;image-rendering:pixelated;border:1px solid var(--border);border-radius:6px;cursor:crosshair"></canvas>';
      line += '<div id="h5-legend" style="max-width:860px"></div>';
      line += '<p class="panel-desc"><button id="h5-png" class="btn" type="button">下载热力图 PNG</button><span id="h5-probe"> 点按网格任意位置读取该单元数值</span></p>';
      return line + '</div>';
    } catch(e) {
      PD = null;
      return '<div class="panel-desc">S-100 网格识别异常：' + esc(String(e.message||e)) + '</div>';
    }
  }
  function drawProduct(){
    if (!PD || !PD.meta) return;
    var g = PD.groups[PD.sel || 0], m = PD.meta;
    try {
      var v = resolveGroup(m.f, g.path).value;
      var rows = m.rows, cols = m.cols, n = rows * cols;
      var A = new Float32Array(n), B = m.extraField ? new Float32Array(n) : null;
      var mn = Infinity, mx = -Infinity, sum = 0, cnt = 0, dry = 0;
      var compound = m.names.length > 0;
      for (var i = 0; i < n; i++) {
        var cell = v[i];
        var num = compound ? (cell ? cell[m.fieldIdx] : null) : (typeof cell === 'object' ? cell[0] : cell);
        num = (typeof num === 'bigint') ? Number(num) : num;
        if (typeof num === 'number' && isFinite(num) && Math.abs(num) < 999999 && num !== PD.fill) {
          A[i] = num; mn = Math.min(mn, num); mx = Math.max(mx, num); sum += num; cnt++;
          if (B) { var b2 = compound ? (cell ? cell[m.extraIdx] : null) : null; b2 = (typeof b2 === 'bigint') ? Number(b2) : b2; B[i] = (typeof b2 === 'number' && isFinite(b2)) ? b2 : 0; }
          if (PD.kind === 'S-102' && num < 0) dry++;
        } else A[i] = NaN;
      }
      if (!cnt) { el('h5-legend').innerHTML = '<p class="panel-desc">该帧无有效数值。</p>'; return; }
      if (PD.kind === 'S-102') mn = Math.max(mn, 0);
      var cv = el('h5-canvas'); cv.width = cols; cv.height = rows;
      var ctx = cv.getContext('2d'); var img = ctx.createImageData(cols, rows); var d = img.data;
      for (var i2 = 0; i2 < n; i2++) {
        var o = i2 * 4, val = A[i2];
        if (val !== val) { d[o]=237; d[o+1]=235; d[o+2]=230; d[o+3]=255; }
        else if (PD.kind === 'S-102' && val < 0) { d[o]=216; d[o+1]=183; d[o+2]=158; d[o+3]=255; }
        else { var col = lerpStops((val - mn) / ((mx - mn) || 1), PD.kind === 'S-111' ? SPEED_STOPS : DEPTH_STOPS); d[o]=col[0]; d[o+1]=col[1]; d[o+2]=col[2]; d[o+3]=255; }
      }
      ctx.putImageData(img, 0, 0);
      if (PD.kind === 'S-111' && B) {
        var S = Math.max(2, Math.round(Math.max(rows, cols) / 26));
        ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = Math.max(.8, Math.max(rows, cols) / 380);
        for (var r2 = S >> 1; r2 < rows; r2 += S) for (var c2 = S >> 1; c2 < cols; c2 += S) {
          var sp = A[r2 * cols + c2]; if (sp !== sp || sp <= 0) continue;
          var dir = (B[r2 * cols + c2] || 0) * Math.PI / 180, dx = Math.sin(dir), dy = -Math.cos(dir), L = S * 0.62;
          ctx.beginPath(); ctx.moveTo(c2 + .5 - dx * L / 2, r2 + .5 - dy * L / 2); ctx.lineTo(c2 + .5 + dx * L / 2, r2 + .5 + dy * L / 2); ctx.stroke();
        }
      }
      PD.cur = A; PD.curB = B;
      var stopsCss = (PD.kind === 'S-111' ? SPEED_STOPS : DEPTH_STOPS).map(function(s2){ return 'rgb(' + s2[1].join(',') + ') ' + Math.round(s2[0]*100) + '%'; }).join(', ');
      var loCn = PD.kind === 'S-102' ? '浅' : '缓', hiCn = PD.kind === 'S-102' ? (mx.toFixed(1) + ' m 深') : (mx.toFixed(2) + PD.uomTxt + ' 急');
      var extraLegend = PD.kind === 'S-102'
        ? '<span style="display:inline-flex;align-items:center;gap:4px;margin-left:10px"><span style="width:12px;height:12px;border-radius:3px;background:#D8B79E;border:1px solid var(--border)"></span>干出</span><span style="display:inline-flex;align-items:center;gap:4px;margin-left:8px"><span style="width:12px;height:12px;border-radius:3px;background:#EDEBE6;border:1px solid var(--border)"></span>填充</span>'
        : '<span style="display:inline-flex;align-items:center;gap:4px;margin-left:10px"><span style="width:12px;height:12px;border-radius:3px;background:#EDEBE6;border:1px solid var(--border)"></span>填充</span>';
      el('h5-legend').innerHTML = '<div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap"><span style="font-size:12px;color:var(--muted);white-space:nowrap">' + loCn + '</span><div style="flex:1;min-width:120px;height:12px;border-radius:6px;background:linear-gradient(90deg,' + stopsCss + ')"></div><span style="font-size:12px;color:var(--muted);white-space:nowrap">' + hiCn + '</span>' + extraLegend + '</div>'
        + '<p class="panel-desc" style="margin-top:6px">均值 ' + (Math.round(sum/cnt*100)/100) + ' · ' + cnt + ' 个有效值' + (dry ? ' · 干出单元 ' + dry : '') + '</p>';
    } catch(e) { el('h5-legend').innerHTML = '<p class="panel-desc">渲染异常：' + esc(String(e.message||e)) + '</p>'; }
  }
  function bindProbe(){
    var cv = el('h5-canvas');
    var pngBtn = el('h5-png');
    if (pngBtn) pngBtn.addEventListener('click', function(){
      if (!PD || !PD.cur) return;
      cv.toBlob(function(blob){
        var a2 = document.createElement('a');
        a2.href = URL.createObjectURL(blob);
        a2.download = (PD.kind === 'S-102' ? 's102-heat' : 's111-current') + '-frame-' + String((PD.sel || 0) + 1).padStart(3, '0') + '.png';
        document.body.appendChild(a2); a2.click(); document.body.removeChild(a2);
        setTimeout(function(){ URL.revokeObjectURL(a2.href); }, 3000);
      });
    });
    cv.addEventListener('click', function(ev){
      if (!PD || !PD.cur || !PD.meta) return;
      var rect = cv.getBoundingClientRect();
      var c = Math.floor((ev.clientX - rect.left) / rect.width * PD.meta.cols), r = Math.floor((ev.clientY - rect.top) / rect.height * PD.meta.rows);
      if (!(c >= 0) || !(r >= 0) || c >= PD.meta.cols || r >= PD.meta.rows) return;
      var i = r * PD.meta.cols + c, a = PD.cur[i], msg = '行 ' + r + ' · 列 ' + c + '：';
      if (a !== a) msg += '填充值';
      else if (PD.kind === 'S-102') msg += '水深 ' + a.toFixed(2) + ' m' + (PD.curB ? ' · 不确定度 ±' + (PD.curB[i] || 0).toFixed(2) + ' m' : '');
      else msg += '流速 ' + a.toFixed(2) + (PD.uomTxt || '') + (PD.curB ? ' · 流向 ' + (PD.curB[i] || 0).toFixed(0) + '°' : '');
      el('h5-probe').textContent = msg;
    });
    var sel = el('h5-gsel');
    if (sel) sel.addEventListener('change', function(){ PD.sel = parseInt(sel.value, 10) || 0; drawProduct(); });
  }
  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  el('h5-tree').addEventListener('click', function(ev){
    var row = ev.target.closest('.h5-row'); if (!row) return;
    var block = row.parentElement;
    var det = block.querySelector('.h5-detail');
    if (det) det.classList.toggle('hidden');
  });
  el('h5-file').addEventListener('change', function(){
    var f = this.files[0]; if (!f) return;
    var rd = new FileReader();
    rd.onload = function(){ handle(rd.result, f.name); };
    rd.readAsArrayBuffer(f);
  });
  el('h5-sample').addEventListener('click', function(){
    status('下载内置样本中…（352KB）');
    fetch('assets/h5wasm/sample-s102.h5').then(function(r){ return r.arrayBuffer(); }).then(function(b){ handle(b, '102US00_US5NYCII.h5'); }).catch(function(e){ status('样本加载失败：' + e.message); });
  });
  el('h5-sample111').addEventListener('click', function(){
    status('下载内置样本中…（682KB）');
    fetch('assets/h5wasm/sample-s111.h5').then(function(r){ return r.arrayBuffer(); }).then(function(b){ handle(b, 'S111US_CBOFS_Chesapeake.h5'); }).catch(function(e){ status('样本加载失败：' + e.message); });
  });
  ['dragover','dragenter'].forEach(function(t){ document.body.addEventListener(t, function(e){ e.preventDefault(); }); });
  document.body.addEventListener('drop', function(e){
    e.preventDefault();
    var f2 = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f2) return;
    status('已接收拖拽文件：' + f2.name);
    var rd = new FileReader();
    rd.onload = function(){ handle(rd.result, f2.name); };
    rd.readAsArrayBuffer(f2);
  });
  boot().then(function(){ status('引擎就绪，上传 .h5 或点「加载内置 S-102 样本」'); }).catch(function(e){ status(e.message); });
})();
</script>`;
  fs.writeFileSync(path.join(OUT_DIR, 'h5.html'), layout('HDF5 / S-100 网格解析器', '浏览器内的 HDF5 解析器：上传 S-102 水深 / S-111 流场 .h5 文件，查看结构树与属性，自动渲染水深 / 流场热力图（可切时序帧、点选读值），基于 h5wasm（WebAssembly），文件不出本机。', H5_PAGE, 'website', `${CFG.siteUrl}/h5.html`, true));
/* ---------------- S-100 测试数据生成器 ---------------- */
const GEN_PAGE = `<section class="post tool-page">
<h1 class="post-title">S-100 测试数据生成器</h1>
<div class="post-meta">基于 IHO S-101 Feature Catalogue 2.0.0 · 纯浏览器本地生成 · v1.1：单 / 批量要素实例（JSON / GeoJSON，可下载）</div>
<p>选一个要素类型，生成属性齐全的合成实例——渲染调试、解析器测试、Mock 数据的起点。枚举属性自动带合法值下拉，必填属性默认勾选。S-101 的运营编码（ISO 8211）请走专业转换工具，这里产出的是给开发用的实例骨架。</p>
<div class="panel">
<h2>1. 选要素类型</h2>
<p class="toolbar"><span class="search"><input id="gen-q" class="search-input" type="search" placeholder="过滤：如 DEPARE / Wreck / 沉船…" aria-label="过滤要素类型"></span></p>
<select id="gen-type" class="input" size="8" style="width:100%"></select>
<p class="toolbar" style="margin-top:8px">
<span class="panel-desc" style="margin:0">几何类型：</span>
<label class="check"><input type="radio" name="gen-geom" value="Point" checked> 点</label>
<label class="check"><input type="radio" name="gen-geom" value="LineString"> 线</label>
<label class="check"><input type="radio" name="gen-geom" value="Polygon"> 面</label>
<span class="panel-desc" style="margin:0">中心经纬度：</span>
<input id="gen-lon" class="input" style="width:90px" value="122.5">
<input id="gen-lat" class="input" style="width:90px" value="31.0">
<span class="panel-desc" style="margin:0">实例数：</span>
<input id="gen-n" class="input" type="number" min="1" max="50" value="5" style="width:70px">
<span class="panel-desc" style="margin:0">散布(°)：</span>
<input id="gen-spread" class="input" type="number" step="0.01" min="0.005" value="0.05" style="width:76px">
</p>
</div>
<div class="panel">
<h2>2. 属性</h2>
<p class="panel-desc" id="gen-attr-desc">选择要素类型后列出属性绑定。</p>
<div id="gen-attrs"></div>
</div>
<p class="toolbar"><button id="gen-go" class="btn" type="button">生 成</button><span id="gen-status" class="panel-desc">正在加载目录数据…</span></p>
<div class="panel hidden" id="gen-out">
<h2>3. 生成结果</h2>
<p class="panel-desc"><strong>JSON</strong>（解析器测试用）<button class="btn" data-copy="gen-json" type="button">复制</button><button class="btn" data-dl="gen-json" type="button">下载 .json</button></p>
<pre class="result" id="gen-json"></pre>
<p class="panel-desc"><strong>GeoJSON Feature / FeatureCollection</strong>（渲染测试用）<button class="btn" data-copy="gen-geo" type="button">复制</button><button class="btn" data-dl="gen-geo" type="button">下载 .geojson</button></p>
<pre class="result" id="gen-geo"></pre>
</div>
<p class="panel-desc">枚举值取自 S-101 目录的合法值清单；复杂属性 v1 暂不生成，仅在属性表中标注。目录数据：IHO S-101 FC 2.0.0，版权归 IHO。</p>
</section>
<script src="assets/s100-fc/fc-data.js"></script>
<script>
(function(){
  var FC = window.FC_DATA || null;
  var cur = null;
  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function status(t){ document.getElementById('gen-status').textContent = t; }
  function attrByCode(code){ return FC.simple.filter(function(a){return a.code===code})[0] || FC.complex.filter(function(a){return a.code===code})[0] || null; }
  function loadTypes(){
    var q = document.getElementById('gen-q').value.toLowerCase();
    var sel = document.getElementById('gen-type');
    var opts = FC.featureTypes.filter(function(o){ return !q || (o.code+' '+o.alias+' '+o.name).toLowerCase().indexOf(q)>=0; })
      .map(function(o){ return '<option value="'+esc(o.code)+'">'+esc(o.code)+(o.alias?' ('+esc(o.alias)+')':'')+' — '+esc(o.name)+'</option>'; });
    sel.innerHTML = opts.join('') || '<option disabled>(无匹配)</option>';
    if (!cur && FC.featureTypes.length) { sel.selectedIndex = 0; showAttrs(); }
  }
  function showAttrs(){
    var code = document.getElementById('gen-type').value;
    cur = FC.featureTypes.filter(function(o){return o.code===code})[0] || null;
    if (!cur) { document.getElementById('gen-attr-desc').textContent = '未选择'; return; }
    document.getElementById('gen-attr-desc').innerHTML = '<strong>'+esc(cur.code)+'</strong> '+esc(cur.name)+' — 共 '+cur.attrs.length+' 个属性绑定';
    document.getElementById('gen-attrs').innerHTML = cur.attrs.map(function(a, i){
      var def = attrByCode(a.ref);
      var isComplex = def && def.attrs ? true : false;
      var required = a.mult.indexOf('0') !== 0;
      var pvs = a.pvs.length ? a.pvs : (def && def.values ? def.values.map(function(v){return v.code}) : []);
      var field;
      if (isComplex) field = '<span class="fc-opt">复杂属性，v1 不生成</span>';
      else if (pvs.length) field = '<select class="input" data-i="'+i+'" data-code="'+esc(a.ref)+'">'+pvs.map(function(v){return '<option>'+esc(v)+'</option>'}).join('')+'</select>';
      else field = '<input class="input" data-i="'+i+'" data-code="'+esc(a.ref)+'" data-vt="'+esc((def&&def.vt)||'H5')+'" style="width:180px" placeholder="'+esc(a.mult)+'">';
      return '<div class="gen-row"><label class="check"><input type="checkbox" class="gen-inc" data-i="'+i+'" '+((required||!isComplex)?'checked':'')+(isComplex?' disabled':'')+'> <code>'+esc(a.ref)+'</code></label> <span class="'+(required?'fc-req':'fc-opt')+'">'+esc(a.mult)+'</span> '+(def?esc(def.name||''):'')+' '+field+'</div>';
    }).join('');
  }
  document.getElementById('gen-q').addEventListener('input', loadTypes);
  document.getElementById('gen-type').addEventListener('change', showAttrs);
  function rnd(a2, b2){ return a2 + Math.random() * (b2 - a2); }
  document.getElementById('gen-go').addEventListener('click', function(){
    if (!cur) { status('请先选择要素类型'); return; }
    var lon = parseFloat(document.getElementById('gen-lon').value) || 0;
    var lat = parseFloat(document.getElementById('gen-lat').value) || 0;
    var N = Math.max(1, Math.min(50, parseInt(document.getElementById('gen-n').value, 10) || 1));
    var spread = Math.max(0.005, parseFloat(document.getElementById('gen-spread').value) || 0.05);
    var geom = (document.querySelector('input[name="gen-geom"]:checked')||{value:'Point'}).value;
    var binds = [];
    [].slice.call(document.querySelectorAll('.gen-inc')).forEach(function(cb){
      if (cb.checked) binds.push({ i: cb.dataset.i, b: cur.attrs[cb.dataset.i] });
    });
    var feats = [], missing = [];
    for (var n2 = 0; n2 < N; n2++) {
      var attrs = {};
      binds.forEach(function(bn){
        var b = bn.b, def = attrByCode(b.ref);
        if (def && def.attrs) { if (n2 === 0) missing.push(b.ref + '（复杂属性）'); return; }
        var el = document.querySelector('.gen-row [data-i="' + bn.i + '"][data-code]');
        var val;
        if (el && el.tagName === 'SELECT') {
          var opts = Array.prototype.map.call(el.options, function(o2){ return o2.value; });
          val = opts[(n2 + el.selectedIndex) % opts.length];
        } else {
          var base = el ? (el.value || '') : '';
          if (def && def.vt === 'real') {
            var num = parseFloat(base);
            val = isNaN(num) ? base : (Math.round(num * (0.8 + 0.4 * Math.random()) * 100) / 100);
          } else if (base) val = (N > 1) ? base + '-' + (n2 + 1) : base;
          else val = '';
        }
        if ((val === '' || val === undefined) && b.mult.indexOf('0') !== 0) { if (n2 === 0) missing.push(b.ref + '（必填未填）'); }
        if (val !== '' && val !== undefined) attrs[b.ref] = (def && def.vt === 'real') ? (parseFloat(val) || val) : val;
      });
      var clon = lon + (N > 1 ? rnd(-spread, spread) : 0), clat = lat + (N > 1 ? rnd(-spread, spread) : 0);
      var coords = { Point: [Number(clon.toFixed(5)), Number(clat.toFixed(5))], LineString: [[Number((clon-0.05).toFixed(5)), Number((clat-0.03).toFixed(5))],[Number(clon.toFixed(5)), Number(clat.toFixed(5))],[Number((clon+0.05).toFixed(5)), Number((clat+0.03).toFixed(5))]], Polygon: [[[clon-0.05,clat-0.03],[clon+0.05,clat-0.03],[clon,clat+0.04],[clon-0.05,clat-0.03]]] };
      feats.push({ type: 'Feature', geometry: { type: geom, coordinates: coords[geom] }, properties: Object.assign({ featureType: cur.code }, attrs),
        __json: { featureType: cur.code, s57Alias: cur.alias || undefined, productName: 'S-101', geometryType: geom, attributes: attrs, note: '合成测试数据 #' + (n2 + 1) } });
    }
    var jsonOut = (N === 1) ? feats[0].__json : feats.map(function(f2){ return f2.__json; });
    var geoOut = (N === 1) ? feats[0] : { type: 'FeatureCollection', features: feats };
    document.getElementById('gen-json').textContent = JSON.stringify(jsonOut, null, 2);
    document.getElementById('gen-geo').textContent = JSON.stringify(geoOut, null, 2);
    document.getElementById('gen-out').classList.remove('hidden');
    status(missing.length ? ('已生成 ' + N + ' 个实例，但缺：' + missing.join('、')) : ('已生成 ' + N + ' 个实例。'));
  });
  document.body.addEventListener('click', function(ev){
    var dl = ev.target.closest('[data-dl]');
    if (dl) {
      var src2 = document.getElementById(dl.dataset.dl);
      var blob = new Blob([src2.textContent], { type: 'application/geo+json' });
      var a2 = document.createElement('a');
      a2.href = URL.createObjectURL(blob);
      a2.download = (cur ? ('s101-' + cur.code.toLowerCase()) : 's101-test') + (dl.dataset.dl === 'gen-geo' ? '.geojson' : '.json');
      document.body.appendChild(a2); a2.click(); document.body.removeChild(a2);
      setTimeout(function(){ URL.revokeObjectURL(a2.href); }, 3000);
      return;
    }
    var b = ev.target.closest('[data-copy]'); if (!b) return;
    var src = document.getElementById(b.dataset.copy);
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(src.textContent);
    var old = b.innerText; b.innerText = '已复制'; setTimeout(function(){ b.innerText = old }, 900);
  });
  if (FC) { loadTypes(); status('目录就绪：S-101 FC 2.0.0'); } else { status('目录数据加载失败'); }
})();
</script>`;
  fs.writeFileSync(path.join(OUT_DIR, 'gen.html'), layout('S-100 测试数据生成器', 'S-100 测试数据生成器：基于 S-101 要素目录生成属性齐全的合成要素实例（JSON / GeoJSON），枚举属性自动带合法值，用于渲染与解析测试。', GEN_PAGE, 'website', `${CFG.siteUrl}/gen.html`, true));

console.log(`✔ 构建完成 → ${OUT_DIR}`);
console.log(`  已发布 ${articles.length} 篇 · 草稿 ${drafts.length} 篇（已生成页面但不进目录/RSS） · 独立页面 ${pages.length} 个 · 工具 ${TOOLS.length} 个`);
