// 把博客 markdown 转成知乎专栏编辑器可粘贴的 HTML 片段
// 用法: node tools-dev/md2zhihu.mjs posts/2025-09-16-s100-family-map.md
// 复用 build.mjs 的 mdToHtml；内链绝对化；知乎端文末引导（知乎无机审红线，但保持克制）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const buildSrc = fs.readFileSync(path.join(ROOT, "build.mjs"), "utf8").split("\n");
var m0 = buildSrc.findIndex(function (l) { return l.indexOf("<md-engine>") >= 0; });
var m1 = buildSrc.findIndex(function (l) { return l.indexOf("</md-engine>") >= 0; });
if (m0 < 0 || m1 < 0) throw new Error("build.mjs missing md-engine markers");
var core = buildSrc.slice(m0 + 1, m1).join("\n");
const { mdToHtml } = new Function(core + "\nreturn { mdToHtml };")();

const mdPath = path.resolve(ROOT, process.argv[2]);
var md = fs.readFileSync(mdPath, "utf8").replace(/\r\n/g, "\n");
md = md.replace(/^---\n[\s\S]*?\n---\n/, "");
let html = mdToHtml(md);
// 内链绝对化（知乎端必须全绝对路径）
html = html.replace(/href="(?!https?:|#|mailto:)([\w\-./]+\.html)"/g, 'href="https://nightchart.cn/$1"');
const tail = `
<hr>
<p>本文首发于个人博客<a href="https://nightchart.cn" target="_blank">航图笔记 nightchart.cn</a>——S-57 / S-52 / S-100 / 渲染引擎源码走读，另有十个配套在线工具，全部免费无广告。这个系列持续更新，欢迎收藏原文获得最佳排版与实时更新。</p>
`;
const titleMatch = fs.readFileSync(mdPath, "utf8").match(/^title:\s*(.+)$/m);
const outPath = path.join(ROOT, "data", "_zhihu_html", path.basename(mdPath).replace(/\.md$/, ".html"));
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html + tail + "\n");
console.log("written:", outPath, "title:", titleMatch ? titleMatch[1].trim() : "(none)");
