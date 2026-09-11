// 把博客 markdown 转成 CSDN 编辑器可直接粘贴的 HTML 片段
// 用法: node tools-dev/md2csdn.mjs data/_csdn_maplibre_v6.md
// 复用 build.mjs 里同一套 mdToHtml，保证与博客渲染一致
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const buildSrc = fs.readFileSync(path.join(ROOT, "build.mjs"), "utf8").split("\n");
// build.mjs 第 42 行 const esc 起，至 mdToHtml 结束（第 247 行），含全部依赖
const core = buildSrc.slice(41, 247).join("\n");
const { mdToHtml } = new Function(core + "\nreturn { mdToHtml };")();

const mdPath = path.resolve(ROOT, process.argv[2]);
const md = fs.readFileSync(mdPath, "utf8").replace(/\r\n/g, "\n");
const html = mdToHtml(md);
const outPath = path.join(ROOT, "data", "_csdn_html", path.basename(mdPath).replace(/\.md$/, ".html"));
fs.writeFileSync(outPath, html + "\n");
console.log("written:", outPath, html.length, "chars");
