# 航图笔记

电子海图与地图渲染技术笔记：S-57 / S-52 / S-100 / MapLibre 源码走读。
零依赖静态站生成器（纯 Node 标准库，无需 npm install），GitHub Pages 自动部署。

## 快速开始

```bash
node build.mjs      # 构建到 publish/
node serve.mjs      # 本地预览 http://localhost:8080（Ctrl+C 停止）
```

## 写一篇新文章

1. 复制 `posts/_TEMPLATE.md`，填 front matter（title / slug / date / description / tags），删掉 `draft: true` 即为发布
2. `node build.mjs && node serve.mjs` 本地看效果
3. 图片放 `assets/` 目录，文中用 `![](assets/xxx.png)` 引用

## 部署

push 到 main 即自动构建部署（`.github/workflows/deploy.yml` → GitHub Actions → Pages）。

## 目录结构

```
chartnotes/
├── build.mjs              # 构建脚本（零依赖，Node 标准库）
├── serve.mjs              # 本地预览服务器
├── config.json            # 站点配置（站名/笔名/URL）
├── template.html          # 页面模板
├── style.css              # 样式（自动跟随系统深色模式）
├── posts/                 # 文章（Markdown）
│   └── _TEMPLATE.md       # 新文章模板
├── assets/                # 图片与符号资源
├── data/                  # 码表/颜色表/对照表等数据源
└── .github/workflows/     # 自动部署
```

内容基于公开标准（IHO S-57 / S-52 / S-100）与开源代码（MapLibre 等），仅代表个人理解。
