"""构建《航图笔记工具箱》离线完整版资源包
- 输入: publish/（站点构建产物）
- 输出: dist-toolbox/航图笔记工具箱-离线完整版/ + zip
- 转换: 去除 Web 依赖（GoatCounter/SW/api 计数），fetch 的本地样本内嵌为 base64 + 垫片
"""
import os, re, shutil, base64, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUB = os.path.join(ROOT, 'publish')
DIST = os.path.join(ROOT, 'dist-toolbox')
NAME = '航图笔记工具箱-离线完整版'
OUT = os.path.join(DIST, NAME)

TOOLS = ['tools.html', 'objl.html', 'attr.html', 's57-s101.html', 'geo-calc.html',
         's52.html', 's52-sim.html', 'fc.html', 'pc.html', 'h5.html', 'gen.html']
ASSET_FILES = [
    'assets/h5wasm/h5wasm.js',
    'assets/h5wasm/sample-s102.h5',
    'assets/h5wasm/sample-s111.h5',
    'assets/s100-fc/s101-fc-2.0.0.xml',
    'assets/s100-pc/PortrayalCatalog_AlertCatalog-S101.xml',
    'assets/s100-pc/PortrayalCatalog_ColorProfiles_colorProfile.xml',
    'assets/s100-pc/PortrayalCatalog_portrayal_catalogue.xml',
]
MIME = {'.xml': 'text/xml', '.h5': 'application/octet-stream', '.js': 'text/javascript'}

os.makedirs(DIST, exist_ok=True)
BUILD = os.path.join(DIST, '_build', NAME)   # 避开被浏览器/资源管理器锁住的输出目录
if os.path.exists(BUILD):
    shutil.rmtree(BUILD)
OUT = BUILD

def strip_web(html):
    # GoatCounter
    html = re.sub(r'<script data-goatcounter=[^>]*></script>', '', html)
    # service worker 注册
    html = re.sub(r"<script>if\('serviceWorker' in navigator\)[\s\S]*?</script>", '', html)
    # manifest 链接
    html = html.replace('<link rel="manifest" href="manifest.webmanifest">', '')
    # 累计使用计数（tools.html 卡片 + 工具页页脚）
    html = re.sub(r'<div class="tool-uses"[\s\S]*?</div>', '', html)
    html = re.sub(r'<div class="tool-views"[\s\S]*?</div>', '', html)
    html = re.sub(r'<script>\(function\(\)\{var els=document\.querySelectorAll\("\\?\"\.tool-uses-n[\s\S]*?\)\(\);</script>', '', html)
    # api/views 兜底清理（文章页式计数器不存在于工具页，但保险）
    html = re.sub(r'fetch\("/api/views[^"]*"[^)]*\)[\s\S]*?\}\)\(\);\s*</script>', '</script>', html)
    return html

EMBED_MAP = {
    'fc.html': ['assets/s100-fc/s101-fc-2.0.0.xml'],
    'pc.html': ['assets/s100-pc/PortrayalCatalog_portrayal_catalogue.xml',
                'assets/s100-pc/PortrayalCatalog_ColorProfiles_colorProfile.xml',
                'assets/s100-pc/PortrayalCatalog_AlertCatalog-S101.xml'],
    'h5.html': ['assets/h5wasm/sample-s102.h5', 'assets/h5wasm/sample-s111.h5'],
}

def embed_assets(html, tool, used):
    paths = EMBED_MAP.get(tool, [])
    if not paths:
        return html
    blocks = ['<script>window.__OFFLINE_ASSETS = window.__OFFLINE_ASSETS || {};</script>']
    for p in paths:
        fp = os.path.join(PUB, p.replace('/', os.sep))
        ext = os.path.splitext(p)[1]
        mime = MIME.get(ext, 'application/octet-stream')
        b64 = base64.b64encode(open(fp, 'rb').read()).decode()
        blocks.append("<script>window.__OFFLINE_ASSETS['%s'] = 'data:%s;base64,%s';</script>" % (p, mime, b64))
        used.add(p)
    shim = ("<script>(function(){var O=window.__OFFLINE_ASSETS;if(!O)return;var of=window.fetch;"
            "window.fetch=function(u){var k=String(u);"
            "for(var key in O){if(k.indexOf(key)>=0){var d=O[key];var b=atob(d.slice(d.indexOf(',')+1));"
            "var arr=new Uint8Array(b.length);for(var i=0;i<b.length;i++)arr[i]=b.charCodeAt(i);"
            "return Promise.resolve(new Response(arr,{status:200,headers:{'content-type':d.slice(5,d.indexOf(';'))}}))}}"
            "return of.apply(this,arguments)};})();</script>")
    blocks.append(shim)
    return html.replace('</head>', chr(10).join(blocks) + chr(10) + '</head>', 1)

os.makedirs(os.path.join(OUT, 'assets'), exist_ok=True)
used = set()
for f in TOOLS:
    html = open(os.path.join(PUB, f), encoding='utf-8').read()
    html = strip_web(html)
    html = embed_assets(html, f, used)
    if f == 'tools.html':
        shutil.copyfile(os.path.join(OUT, os.devnull), os.devnull) if False else None
    open(os.path.join(OUT, f), 'w', encoding='utf-8', newline='\n').write(html)
    print('packed', f)

for a in set(ASSET_FILES) | used:
    dst = os.path.join(OUT, a.replace('/', os.sep))
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copyfile(os.path.join(PUB, a.replace('/', os.sep)), dst)
    print('asset', a)

shutil.copyfile(os.path.join(PUB, 'style.css'), os.path.join(OUT, 'style.css'))
shutil.copyfile(os.path.join(PUB, 'favicon.svg'), os.path.join(OUT, 'favicon.svg'))

readme = '''航图笔记 · 工具箱离线完整版 v1.0
====================================

面向内网 / 离线 / 涉密环境的海图（ECDIS）开发速查工具集，共 10 个工具，
全部纯前端本地运行，无需安装、无需联网、数据不出本机。

使用方法
--------
1. 解压本压缩包到任意目录
2. 用 Chrome 或 Edge 浏览器打开 tools.html 即可（建议收藏）

包含工具
--------
- objl.html   S-57 对象类码表（179 类全量速查）
- attr.html   S-57 属性码表（300+ 属性）
- s57-s101.html  S-57 ↔ S-101 要素对照表（160 个对象，挂 DCEG 条款）
- s52.html    S-52 颜色与符号速查（63 token × 5 色板 + 166 符号）
- s52-sim.html   S-52 昼夜模拟器（等深线滑块 + 三色板实时切换）
- fc.html     S-100 要素目录（FC）解析器（内置 S-101 FC 2.0.0 样本）
- pc.html     S-100 图示表达目录（PC）解析器（内置 PC 2.0 样本）
- h5.html     HDF5 / S-100 网格解析器（内置 NOAA S-102 / S-111 官方样本）
- gen.html    S-100 测试数据生成器（JSON / GeoJSON 导出）
- geo-calc.html  坐标 / 磁差速算（WMM2025，批量）

说明
----
- 在线版与更新：nightchart.cn/tools.html
- 深度文章配套：nightchart.cn（S-57 / S-52 / S-100 系列源码走读）
- 内置样本数据来源：NOAA（公有领域）、IHO 公开分发件；版权归原作者/机构
- 本包仅供个人学习与开发测试使用；航海用途请务必使用官方授权渠道海图

—— 夜航海图 · 航图笔记
'''
open(os.path.join(OUT, '使用说明.txt'), 'w', encoding='utf-8-sig', newline='\n').write(readme)

zip_path = os.path.join(DIST, NAME + '-v1.0.zip')
with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for root, _, files in os.walk(OUT):
        for f in files:
            fp = os.path.join(root, f)
            z.write(fp, os.path.join(NAME, os.path.relpath(fp, OUT)))
print('ZIP:', zip_path, os.path.getsize(zip_path), 'bytes')
print('DONE. folder:', OUT)
