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
const md = fs.readFileSync(mdPath, "utf8").replace(/\r\n/g, "\n");
const html = mdToHtml(md);
// 文末统一追加公众号引导（CSDN 编辑器粘贴时会把外链图转存到 CSDN 图床）
const wechatTail = `\n<hr>\n<p><strong>微信扫码关注公众号「航图笔记」</strong>：新文章与工具更新第一时间推送，微信搜索「航图笔记」也可找到。</p>\n<p><img src="https://nightchart.cn/assets/wechat-qrcode.png" alt="微信公众号航图笔记二维码" width="240"></p>\n`;
const outPath = path.join(ROOT, "data", "_csdn_html", path.basename(mdPath).replace(/\.md$/, ".html"));
fs.writeFileSync(outPath, html + wechatTail + "\n");
console.log("written:", outPath, (html + wechatTail).length, "chars (含公众号文末引导)");
