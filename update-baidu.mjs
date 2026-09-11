// 百度站长平台主动推送：把 sitemap 里的 URL 推给百度，加速收录
// 用法：
//   1. 根目录放 baidu_token.txt（百度站长平台"普通收录"页的推送接口 token，勿入库）
//   2. node update-baidu.mjs            ← 推送 sitemap 全部 URL
//      node update-baidu.mjs URL1 URL2  ← 只推指定 URL
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SITE = 'nightchart.cn';
const tokenFile = path.join(ROOT, 'baidu_token.txt');

if (!fs.existsSync(tokenFile)) {
  console.error('缺少 baidu_token.txt（百度站长平台 → 普通收录 → 推送接口 token）。');
  console.error('该文件不入库；写入 token 后重跑本脚本。');
  process.exit(1);
}
const token = fs.readFileSync(tokenFile, 'utf8').trim();

let urls;
if (process.argv.length > 2) {
  urls = process.argv.slice(2);
} else {
  const sm = fs.readFileSync(path.join(ROOT, 'publish', 'sitemap.xml'), 'utf8');
  urls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}
urls = urls.filter((u) => u.startsWith('http'));
if (!urls.length) {
  console.error('没有可推送的 URL');
  process.exit(1);
}

const r = await fetch(
  `http://data.zz.baidu.com/urls?site=${SITE}&token=${token}`,
  { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: urls.join('\n') },
);
const j = await r.json().catch(() => null);
console.log('百度推送:', r.status, JSON.stringify(j));
if (j && j.success !== undefined) {
  console.log(`成功 ${j.success} 条，剩余配额 ${j.remain}（当日）`);
}
