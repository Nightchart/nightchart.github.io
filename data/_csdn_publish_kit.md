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
- 2026-09-17：《S-104：让海图知道"现在水位几米"》✅ 已发布（内浏览器自动发布；第二篇触发微信扫码确认，扫码后秒发）https://blog.csdn.net/nightchart/article/details/165751076
- 2026-09-18：《S-111：让海图知道"水往哪流"》✅ 已发布（内浏览器自动发布，无需扫码；标签 c++/图形渲染/数据可视化）https://blog.csdn.net/nightchart/article/details/165840536

## ✅ 迁移完成（2026-09-18）：全部文章均已发布至新号 nightchart，本 kit 转为存档
- 无待发。标签经验：GIS/地图不存在于 CSDN 标签库，海洋主题用 c++/图形渲染/数据可视化


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


## 迁移第二波（2026-09-18 起）

- 今日额度剩 1 篇，选定：《S-64：IHO 官方测试数据集，渲染器的陪练》（主站 09-17 刚发布并优化）
- 源 md：data/_s64_csdn_src.md（已加首发声明/图改文字注/签名带链接）→ 正文 HTML：data/_csdn_html/_s64_csdn_src.html
- 复制页：data/_csdn_copier_s64.html（自动化通道断开时的桥接）
- 标题：S-64：IHO 官方测试数据集，渲染器的陪练 | 摘要用主站 description | 标签：测试/ECDIS/IHO（不存在则用 开源 替代）
- 后续队列：s101-portrayal-lookup → s52-portrayal（可带昼夜模拟器链接）→ s124；每篇需先跑 md2csdn 转换

- 2026-09-18（第二波第 1 篇）：《S-64：IHO 官方测试数据集，渲染器的陪练》✅ 已发布（标签 测试工具/开源）https://blog.csdn.net/nightchart/article/details/165875206
- 发布流程升级：tools-dev/_publish_loop.py 自动循环弹二维码+探测扫码结果（人只负责扫码）；扫码是当日首篇后随机触发的风控

- 2026-09-19：《S-125：让海图知道"航标还正常吗"》✅ 主站+CSDN 同步发布（CSDN：https://blog.csdn.net/nightchart/article/details/165892485 ，标签 船舶（自定义标签通道验证成功：原生键入+Enter））
- 自定义标签经验：搜索无候选时，type 原生键入 + press Enter（可信事件）可添加自定义标签；合成 KeyboardEvent 无效

- 2026-09-20：《S-101 的图示表达：Look-up 表怎么工作》✅ 已发布（标签 ECDIS/S-101 自定义标签；发布循环第 2 轮秒过）https://blog.csdn.net/nightchart/article/details/166016778
- 第二波队列更新：~~s101-portrayal-lookup~~ ✅ → 剩 s52-portrayal、s124（每篇先 md2csdn 转换+内链绝对化）


## 资源包上架材料：《航图笔记工具箱·离线完整版 v1.0》（2026-09-20 制作）

- **成品 zip**：dist-toolbox/航图笔记工具箱-离线完整版-v1.0.zip（3.1MB，已 gitignore 不入库）
- **预览图**：dist-toolbox/product-preview.png
- **上架地址**：mp.csdn.net/mp_download/manage/release（新建下载资源，zip 手动上传——IAB 不支持文件选择器）
- **标题**：航图笔记工具箱·离线完整版：10 个海图/ECDIS 开发速查工具（S-57/S-52/S-100，含样本数据）
- **简介**：面向内网/离线/涉密环境的海图开发工具集。S-57 对象类与属性码表、S-57↔S-101 对照表（160 对象挂 DCEG 条款）、S-52 色板符号速查与昼夜模拟器、S-100 要素目录/图示表达解析器（内置 S-101 官方样本）、HDF5 网格解析器（内置 NOAA S-102/S-111 样本）、测试数据生成器、坐标磁差速算（WMM2025）。解压双击 tools.html 即用，Chrome/Edge，纯前端本地运行，无需安装联网，数据不出本机。配套深度教程见 nightchart.cn。
- **标签**：电子海图/ECDIS/S-100/开发工具
- **建议定价**：¥9.9（CSDN 资源常见价位；也可 ¥4.9 走量）
- **质量验证**：fc/pc/h5 三工具垫片实测通过（样本 base64 hash 校验一致、加载解析成功）；无任何网络依赖残留

## ⚠️ CSDN 机审红线（2026-09-20 实测）

- 文末**不要**追加任何公众号导流（含纯文字）：机审判「广告-公众号」拒绝，三连拒实测。
- 已发布的 S-64/S-104/S-102 文末有「更多内容与工具更新，微信搜索：夜航海图，主站 nightchart.cn 同步更新。」——该句式已过审，可复用；但未来发布流程**不自动追加**。
- 公众号名是「夜航海图」（不是「航图笔记」）。

## CSDN 发布流水线实操要点（2026-09-20 S-52 发布四轮拉锯总结）

- 标题输入是 `textarea[placeholder*=文章标题]`（不是 input）；正文用 `CKEDITOR.instances.editor.setData()` 注入（DOM 直注不同步模型，会发出空文）。
- 必须等 `CKEDITOR.instances.editor.status==='ready'` 且 getData 非空后再原子完成：填标题 → 点发布（完整鼠标事件序列）。
- 「审核未通过」弹窗会挡编辑器加载：点「继续编辑」进线上版；弹窗交互会清掉已填表单，先填后弹=白填。
- 新文章发布有每日额度；编辑已发布文章更新不受额度限制。
- md2csdn 已自动剥离 front matter（2026-09-20 起），旧转换注意检查产物开头。
- 转换后内链绝对化：href 相对路径 → https://nightchart.cn/*.html（md2csdn 不做，发布前手动或脚本处理）。

## 草稿队列档期（09-24 凌晨优化后）

| 档期 | 主站 slug | 状态 |
|---|---|---|
| 最先（等审） | s101-portrayal-rules《当 Look-up 表变成程序》 | 草稿 |
| 09-28 | s131-harbour《S-131：把港口装进一张图》 | 草稿 |
| 10-05 | s123-marine-radio《S-123：无线电服务也能成为海图产品》 | 草稿 |
| 10-12 | toolkit-guide《航图笔记工具箱：十个工具的使用场景指南》 | 草稿 |
| 10-19 | s401-inland《S-401：当电子海图开进内河》 | 草稿 |

- 四篇均已 md2csdn 预转换（data/_csdn_html/，含 front matter 剥离与内链绝对化），发布日直接注入。
- 发布流程 SOP：编辑器（新文章无 id 时先存草稿→继续编辑绑定 id）→ textarea 填标题 → CKEDITOR setData → 摘要/标签 → 原子发布。
- 文末已自动带「关注博主不迷路」站内引导（csdnTail）。