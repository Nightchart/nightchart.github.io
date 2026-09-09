// 从 GoatCounter API 拉取各路径访问数，更新 data/gc-counts.json
// 用法：node update-gc.mjs  （需要根目录有 gc_token.txt，权限 Read statistics）
// API 参考：https://www.goatcounter.com/help/api （GET /api/v0/paths + /api/v0/stats/hits）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = path.join(ROOT, 'gc_token.txt');
const DATA_FILE = path.join(ROOT, 'data', 'gc-counts.json');
const BASE = 'https://nightchart.goatcounter.com';

const token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
const H = { Authorization: `Bearer ${token}` };

const get = async (p) => {
  const r = await fetch(BASE + p, { headers: H });
  if (!r.ok) throw new Error(`${p} -> ${r.status}`);
  return r.json();
};

// 1) 路径清单（path_id -> 路径）
const { paths } = await get('/api/v0/paths');
const idToPath = new Map(paths.map((p) => [p.id, p.path]));

// 2) 各路径访问数（daily=1 返回 hits 数组，count 为该路径总访问）
const { hits } = await get('/api/v0/stats/hits?daily=1');

const old = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const out = { ...old };
let changed = 0;
for (const h of hits) {
  const key = idToPath.get(h.path_id) || h.path || `#${h.path_id}`;
  if ((out[key] || 0) !== h.count) changed++;
  out[key] = h.count;
}
out._updated = new Date().toISOString().slice(0, 10);
fs.writeFileSync(DATA_FILE, JSON.stringify(out, null, 2) + '\n');
console.log(`已更新 data/gc-counts.json：${hits.length} 个路径，${changed} 处变化（截至 ${out._updated}）`);
console.log(JSON.stringify(out, null, 2));
