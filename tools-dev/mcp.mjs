// 通用 MCP stdio 客户端：node mcp.mjs <server.js> list | call <tool> '<jsonArgs>' | callin <tool> <argsFile>
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const [, , server, sub, ...rest] = process.argv;
const extraArgs = (process.env.MCP_SERVER_ARGS || '').split(' ').filter(Boolean);
const child = spawn(process.execPath, [server, ...extraArgs], { stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
const pending = new Map();
let nextId = 1;

child.stdout.setEncoding('utf8');
child.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    if (process.env.MCP_DEBUG) console.error('[raw] ' + line.slice(0, 300));
    try {
      const msg = JSON.parse(line);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    } catch { /* 忽略非 JSON 行 */ }
  }
});
child.stderr.setEncoding('utf8');
child.stderr.on('data', (d) => process.stderr.write('[srv] ' + d));

const rpc = (method, params = {}) => new Promise((res, rej) => {
  const id = nextId++;
  params = { ...params, _meta: { ...(params._meta || {}), 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} } };
  pending.set(id, (msg) => (msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result)));
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout: ' + method)); } }, 120000);
});

let init;
try {
  init = await rpc('server/discover', {});
} catch (e) {
  console.error('[mcp] discover failed, fallback initialize:', e.message.slice(0, 120));
  init = await rpc('initialize', { protocolVersion: '2026-07-28', capabilities: {}, clientInfo: { name: 'cli', version: '1.0' } });
}
console.error('[mcp] init result:', JSON.stringify(init).slice(0, 300));
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
const srvName = init?.serverInfo?.name || '?';
console.error('[mcp] connected:', srvName);

if (sub === 'list') {
  const r = await rpc('tools/list', {});
  for (const t of r.tools) console.log(t.name, '|', (t.description || '').slice(0, 70));
  } else if (sub === 'call' || sub === 'callin') {
  const tool = rest[0];
  let args;
  if (sub === 'call') args = rest[1] ? JSON.parse(rest[1]) : {};
  else args = JSON.parse(fs.readFileSync(rest[1], 'utf8'));
  const sessionId = process.env.ZCODE_SESSION_ID || '';
  const reqCtx = sessionId ? { 'com.zcode/request-context': { session_id: sessionId, runtime_scope: 'main' } } : {};
  const r = await rpc('tools/call', { name: tool, arguments: args, _meta: { ...reqCtx } });
  console.log(JSON.stringify(r, null, 1).slice(0, 4000));
}
child.kill();
process.exit(0);
