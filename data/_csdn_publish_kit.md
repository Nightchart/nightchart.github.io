# CSDN Day 3 发布清单（2026-09-12）

两篇都已按 2026-09-12 凌晨主站勘误同步修正。手动发布流程（每篇约 2 分钟）：

1. 打开 https://editor.csdn.net/md/ （已登录的新号 nightchart）
2. 标题栏粘贴下方「标题」
3. 正文区切到 Markdown 模式或直接粘贴对应 HTML 文件全文（记事本打开复制）：
   - 第 1 篇正文：`data/_csdn_html/_csdn_toolkit.html`
   - 第 2 篇正文：`data/_csdn_html/_csdn_maplibre_v6.html`
4. 发布面板：勾原创（默认已选）、填标签、粘贴摘要，点发布，微信扫码确认

---

## 第 1 篇 · S-57 工具箱

- **标题**：给 S-57 开发者的四个在线速查工具
- **标签**：GIS、地图、c++（老号同款）
- **摘要**：对象类码表、属性码表、S-57↔S-101 官方对照、坐标/磁差速算——四个免费纯前端的 S-57 开发速查工具，附实现思路与数据来源。
- **正文文件**：data/_csdn_html/_csdn_toolkit.html
- 对应主站：https://nightchart.cn/s57-toolkit.html

## 第 2 篇 · MapLibre v6（编译）

- **标题**：MapLibre GL JS v6 正式发布：v5 之后八个月的第一个大版本，迁移前必读（编译）
- **标签**：前端、javascript、地图
- **摘要**：编译自 MapLibre 官方 Newsletter（2026-08）：v6 正式发布，v5 之后八个月首个大版本； breaking changes 全清单、迁移要点与笔者点评。
- **正文文件**：data/_csdn_html/_csdn_maplibre_v6.html
- 编译声明已在正文开头保留

---

备注：
- 若当天只发得了一篇，优先发第 1 篇（toolkit），maplibre v6 可顺延
- 发布后把文章 URL 追加到本文件下方存档

## 发布存档

- 2026-09-14：《给 S-57 开发者的四个在线速查工具》（toolkit）✅ 已发布（新号，URL 待补）
- 2026-09-14：《S-101 数据模型：和 S-57 到底差在哪》✅ 已发布（新号，URL 待补；内容含 09-12 勘误版）
- 2026-09-15：《MapLibre GL JS v6 正式发布：v5 之后八个月的第一个大版本，迁移前必读（编译）》✅ 已发布（内浏览器自动发布，审核中）https://blog.csdn.net/nightchart/article/details/165483472
- 2026-09-17：《S-102：当水深从线变成网格》✅ 已发布（内浏览器自动发布，审核中；标签 c++/图形渲染）https://blog.csdn.net/nightchart/article/details/165744577
- 待发：s104 + s111（Day 5）；s102 已于 09-17 自动发布（GIS/地图标签在 CSDN 不存在，用 c++/图形渲染 替代）


---

# Day 4 清单（2026-09-13，同上流程）

## 第 3 篇 · S-101 数据模型

- **标题**：S-101 数据模型：和 S-57 到底差在哪
- **标签**：GIS、地图、c++
- **摘要**：用 160 个对象的迁移数据拆解 S-101 与 S-57 的四点本质差异：要素/信息分家、关联关系一等公民、复杂属性终结光态天书、8211 封装延续但内容模型全新。
- **正文文件**：data/_csdn_html/_csdn_s101dm.html
- 对应主站：https://nightchart.cn/s101-data-model.html

## 第 4 篇 · S-102 水深网格

- **标题**：S-102：当水深从线变成网格
- **标签**：GIS、地图、c++
- **摘要**：S-102 水深表面产品拆解：多波束网格如何取代 DEPARE 加散点水深，逐元不确定度带来什么，渲染端的安全等深线为什么会变成一道分析题——附真实 NOAA 测试数据的实测数字。
- **正文文件**：data/_csdn_html/_csdn_s102.html
- 对应主站：https://nightchart.cn/s102-grid.html

> 每天限 2 篇。若 Day 3（toolkit + maplibre v6）还没发完，优先补 Day 3，Day 4 顺延。

# 掘金粘贴稿（无需转 HTML，掘金编辑器直接吃 Markdown）

- **下一篇候选**：S-111 流场 → `data/_juejin_s111.md`（标题：S-111：让海图知道"水往哪流"；标签建议：后端、GIS、地图；摘要用主站 description）
- 已含首发声明与绝对化链接。若 S-111 已在掘金发过，下一篇顺延为 S-124（`posts/2025-11-11-s124-navwarning.md`，需同款转换，说一声即生成）。


---

# Day 5 清单（09-15，同上流程）

## 第 5 篇 · S-104 水位

- **标题**：S-104：让海图知道"现在水位几米"
- **标签**：GIS、地图、c++
- **摘要**：拆解 NOAA 官方 S-104 水位预报样本：25 个站点 × 4 个时刻的潮位时序、趋势码与填充值约定——水深是相对基准面的，而基准面本身在动。
- **正文文件**：data/_csdn_html/_csdn_s104.html
- 对应主站：https://nightchart.cn/s104-waterlevel.html

## 第 6 篇 · S-111 流场

- **标题**：S-111：让海图知道"水往哪流"
- **标签**：GIS、地图、c++
- **摘要**：拆解 NOAA CBOFS 的 S-111 官方样本：54×54 网格 × 48 个整点时刻的潮流场、knots 单位与 -9999 填充值、directionToward 方向约定——顺带把浏览器端解析 HDF5 复合数据集的两个坑讲清楚。
- **正文文件**：data/_csdn_html/_csdn_s111.html
- 对应主站：https://nightchart.cn/s111-surface-current.html

> 至此 CSDN 迁移包 7 篇全部排完（roadmap/s57anatomy/deadlock/s100map 已发 + toolkit/maplibre/s101dm/s102/s104/s111 待发）。
