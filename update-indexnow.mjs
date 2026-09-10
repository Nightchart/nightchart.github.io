// 向 IndexNow（Bing/Yandex 等）推送 sitemap 里的全部 URL，加速收录
// 用法：node update-indexnow.mjs   （需根目录有 indexnow-key.txt，且密钥文件已部署到站点根目录）
// 协议：https://www.indexnow.org/documentation
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const key = fs.readFileSync(path.join(ROOT, 'indexnow-key.txt'), 'utf8').trim();
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const host = CFG.siteUrl.replace(/^https?:\/\//, '');
const keyLocation = `${CFG.siteUrl}/${key}.txt`;

const xml = fs.readFileSync(path.join(ROOT, 'publish', 'sitemap.xml'), 'utf8');
const urlList = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

const r = await fetch('https://api.indexnow.org/submitindexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host, key, keyLocation, urlList }),
});
console.log(`IndexNow 推送 ${urlList.length} 条 URL -> HTTP ${r.status}`);
// 200/202 = 已受理；400/403/422 通常是密钥文件未部署或格式问题
if (r.status === 200 || r.status === 202) {
  const done = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'gc-counts.json'), 'utf8'));
  done._indexnow = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(ROOT, 'data', 'gc-counts.json'), JSON.stringify(done, null, 2) + '\n');
}
