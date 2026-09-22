// 把博客 markdown 转成 CSDN 编辑器可直接粘贴的 HTML 片段
// 用法: node tools-dev/md2csdn.mjs data/_csdn_maplibre_v6.md
// 复用 build.mjs 里同一套 mdToHtml，保证与博客渲染一致
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const buildSrc = fs.readFileSync(path.join(ROOT, "build.mjs"), "utf8").split("\n");
// 取 <md-engine> … </md-engine> 标记之间的 mdToHtml 引擎及全部依赖（行号免疫）
var m0 = buildSrc.findIndex(function (l) { return l.indexOf("<md-engine>") >= 0; });
var m1 = buildSrc.findIndex(function (l) { return l.indexOf("</md-engine>") >= 0; });
if (m0 < 0 || m1 < 0) throw new Error("build.mjs missing md-engine markers");
var core = buildSrc.slice(m0 + 1, m1).join("\n");
const { mdToHtml } = new Function(core + "\nreturn { mdToHtml };")();

const mdPath = path.resolve(ROOT, process.argv[2]);
var md = fs.readFileSync(mdPath, "utf8").replace(/\r\n/g, "\n");
// 剥离 front matter（--- 开头的 YAML 头），否则会作为正文段落出现在 CSDN 文章开头
md = md.replace(/^---\n[\s\S]*?\n---\n/, "");
const html = mdToHtml(md);
// 不追加任何公众号引导：2026-09-20 实测 CSDN 机审对文末公众号导流（含纯文字）稳定判「广告-公众号」拒绝
// （S-64/S-104/S-102 三篇三连拒）。CSDN 端放弃文末推广，主站/知乎端照常。
const csdnTail = `
<hr>
<p>这个系列持续更新（S-100 全家族拆解中），<strong>关注博主不迷路</strong>；完整在线工具与最新文章见 <a href="https://nightchart.cn" target="_blank">nightchart.cn</a>。</p>
`;
const outPath = path.join(ROOT, "data", "_csdn_html", path.basename(mdPath).replace(/\.md$/, ".html"));
fs.writeFileSync(outPath, html + csdnTail + "\n");
console.log("written:", outPath, (html + csdnTail).length, "chars (含关注引导尾)");
