---
title: S-123：无线电服务也能成为海图产品
slug: s123-marine-radio
date: 2026-10-05
description: 实测拆解 S-123 海上无线电服务（MRS）产品规范的图示表达包：电台、GMDSS 区、NAVTEX 播发区、气象警报区全是物标，26 个 XSLT 规则文件分层工程化——还有官方包里拼错的 Meteorological 和韩语文件名。
tags: S-123, S-100, 海上无线电, GMDSS, 图示表达
draft: true
---

先纠一个高频误会，包括我自己此前也差点写错：**S-123 不是航行警告**——航行警告的 S-100 形态是 S-124。S-123 的全名是 Marine Radio Services（海上无线电服务）产品规范，Ed 1.0.0，分发目录名写得明明白白。它管的是另一件容易被忽略的事：**把"看不见摸不着"的无线电服务信息变成物标**。

素材依旧是真实分发件：S-123 的 Portrayal 包（26 个规则文件、87 个 XML、657 个符号），全部喂给[工具页的 PC 解析器](pc.html)实测通过。这篇讲三个东西：它的物标面有多"软"、它的 XSLT 规则怎么组织、以及官方包里两个有意思的细节。

## 物标面：把电磁波画成多边形

S-57 时代，VHF 岸台、NAVTEX 播发这些信息住在航标表和无线电信号表（ALL）里——**表格形态，人查的**。S-123 把它们升格成空间物标：

- **RadioStation / RadioServiceArea**：无线电台和它的服务区——服务区是个多边形，覆盖边界就是几何
- **GMDSSArea**：全球海上安全通信系统的海区划分（A1/A2/A3/A4 那套）
- **NavtexStationArea**：NAVTEX 播发站的覆盖区
- **InmarsatOceanRegionArea**：Inmarsat 卫星的洋区
- **WeatherForecastWarningArea / NavigationalMeteorologicalArea / ForecastAreaAggregate**：气象预报与警报区
- **FuzzyAreaAggregate / IndeterminateZone**：模糊聚合区与不确定区——服务覆盖边界本来就有渐变和不确定性，规范直接给了表达它的物标

这套物标面的共同点：**几何画的是"服务能力的边界"，不是自然物**。信号覆盖、播发范围、预报分区，边界随台站开关、功率调整、气象过程动态变化。这也是为什么 S-123 的图示表达大量依赖文字注记（频道号、频率、播发类型），[拆 S-101 规则那篇](s101-portrayal-rules.html)里的海警站规则里 `communicationChannel` 条件注记就是典型——服务的核心信息是频道号，符号旁边必须跟着字。

## XSLT 规则的工程化分层

S-123 的图示表达用 XSLT（和 S-111 一路，从 S-52 PresLib 技术线迁移而来）。26 个规则文件不是平铺的，分了三层：

1. **公共模板层**：`main.xsl`、`textStyle.xsl`、`simpleLineStyle.xsl`、`attributeRules.xsl`——字体、线型、属性转文本的复用模板
2. **物标规则层**：`RadioStation.xsl`、`GMDSSArea.xsl`……每个物标一个文件，`xsl:template match` 按物标名和几何类型匹配
3. **变体层**：`_COMMON` 后缀的共享变体（`Building_COMMON.xsl`、`Landmark_COMMON.xsl`）——同一物标在不同上下文复用的模板组

这个分层让"改一个物标的画法"和"改全局字体"是两个互不干扰的提交——对规则包的维护来说，工程结构和渲染逻辑同等重要。

## 官方包里的两个细节

拆包的快乐在于总有彩蛋。其一：规则文件里有 `NavigationalMeterorologicalArea.xsl`——**Meteorological 拼成了 Meterorological**，少了个 o，官方分发件原样带着这个 typo。标准不是圣旨，是工程产物。其二：一个规则文件的文件名是韩语（"规则 基本"），多国协作的产品规范，工作语言痕迹就这样留在了分发件里。

工具实测的完整数字再报一遍：S-123 包 87 个 XML、657 个 SVG、26 个规则文件（11 个物标的 XSLT 规则），[PC 解析器](pc.html)双引擎里的 XSLT 那条管道全通过，符号按调色板着色渲染。

S-123 和 [S-124](s124-navwarning.html) 合起来看，S-100 时代"信息产品"的谱系就齐了半边：**事件类**（警告，突然出现要求被看见）和**服务类**（覆盖与能力，长期存在供查询）。渲染端的挑战不同——前者要抢注意力，后者要可检索。港口场景的 S-131 已在[上一篇](s131-harbour.html)拆过；至此，事件、服务、场景三种信息产品的图示表达就都过了一遍。

---

我是夜航海图，做海图与地图渲染开发的工程师。博客「航图笔记」同步更新全部文章，欢迎 RSS 订阅。
