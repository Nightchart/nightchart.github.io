> **首发于个人博客**：[航图笔记 nightchart.cn](https://nightchart.cn/s57-toolkit.html)（S-57 / S-52 / S-100 / 渲染引擎源码走读，持续更新）。CSDN 同步发布，转载请保留出处。

做电子海图（ENC / ECDIS）二次开发，有几样东西的查阅频率高得离谱：S-57 的对象类和属性编码、S-101 的新旧要素对应关系、投影带和磁差。官方答案都在 IHO 的 PDF 里，每次翻文档都要在几百页里找一个缩写。

于是我把这些高频查询做成了四个在线工具：**不用登录、不用安装、纯前端、手机能开**。本文逐个介绍，顺带把实现思路和数据来源讲清楚，想自建同类工具的可以直接抄。

## 一、S-57 对象类码表

**地址：https://nightchart.cn/objl.html**

179 个核心 ENC 对象类（OBJL）全量速查：编码、缩写、英文名、中文译名、图元类型（点/线/面）。输入 `DEPARE`、`深度` 或 `wreck` 都能实时过滤；41 个开发中的高频对象标了 ★，勾选"只看常用"可以收窄到日常真正会碰的那一批。

数据来自 GDAL 的 `s57objectclasses.csv`（源自 IHO S-57 Appendix A 公开目录），但做了一层清洗：去掉了内河水道（IW）和军用图层（AML）的扩展对象，只留核心 ENC 目录。

## 二、S-57 属性码表

**地址：https://nightchart.cn/attr.html**

200 项属性（ATT）速查，中文译名基本全覆盖。最有用的部分是给高频属性附了**枚举值中文释义**——比如 `WATLEV` 直接告诉你 1=常年干出、2=常年淹没、3=周期性干出、4=漂浮，不用再翻 Appendix A Chapter 2 的表格。

顺带提醒一个我记错的坑：顶标属性的缩写是 **TOPSHP**（Topmark/daymark shape），很多人会记成 TOPMAR——S-57 里没有 TOPMAR。

## 三、S-57 ↔ S-101 要素对照表

**地址：https://nightchart.cn/s57-s101.html**

S-100 时代最现实的问题是：手上的 S-57 数据到 S-101 里变成了什么。这个页面给出 160 个 S-57 对象的官方转换目标，每行带 S-101 DCEG 条款引用（如 DEPARE → Depth Area，DCEG 11.7）。

数据不是凭记忆整理的，提取自 IHO conversion sub-WG 官方仓库的《S-57 to S-101 Conversion Guidance》文档。几个值得知道的点：

- **一对多很常见**：BRIDGE 会拆成 Bridge / Span Fixed / Span Opening 三个 S-101 要素——S-101 把桥梁建模拆细了
- **有不转换清单**：CTRPNT（控制点）、ICNARE 等对象在 S-101 中已移除
- 元对象去向不同：M_QUAL → Quality of Bathymetric Data，M_COVR → Data Coverage

## 四、坐标 / 磁差速算

**地址：https://nightchart.cn/geo-calc.html**

三个计算器合在一页：

- **磁差计算**：按 NOAA WMM2025 模型（2025.0–2030.0 有效期），输入经纬度和日期，输出磁差、年变率、磁倾角、总强度；水平强度低于 6000 nT 时会提示磁罗经不可靠。磁差东偏为正、西偏为负，和海图上的 Var. 一致
- **经纬度 ↔ Web 墨卡托**（EPSG:3857）：做 Web 端底图的基本功
- **经纬度 ↔ UTM / 高斯-克吕格 3°带**：UTM 按 WGS84 六度带，高斯按 CGCS2000 三度带（国内 GIS 同学常用），南半球假定北有开关

全部在浏览器本地计算，断网可用。当然，航海用途请以官方海图和 ECDIS 为准——工具定位是开发速查。

## 实现思路

四个工具是同一套极简架构，想自建的可以直接抄：

1. **零依赖静态生成**：一个几百行的 Node 脚本在构建期把 CSV/JSON 数据内嵌进页面，浏览器里用原生 JS 做过滤渲染，没有框架、没有构建链依赖，托管在 GitHub Pages 上
2. **算法构建期校验**：磁差用的 WMM2025 算法，在构建脚本里对照 NOAA 官方测试值自动验证（偏差超过 10⁻⁶° 直接让构建失败）——移植算法却不加校验，等于裸奔
3. **数据都有出处**：码表来自 GDAL 目录（IHO 公开数据），对照表来自 IHO 官方转换文档，每个页面都标注了数据来源和"以 IHO 原始出版物为准"的声明

## 开始用

四个工具都在 [nightchart.cn/tools.html](https://nightchart.cn/tools.html)，缺什么工具欢迎邮件 hi@nightchart.cn 提议。这个博客在持续写 S-57 解析、S-100 迁移和渲染引擎源码拆解，欢迎收藏。
