---
title: 当 Look-up 表变成程序：拆解 S-101 的 215 条渲染规则
slug: s101-portrayal-rules
date: 2026-09-21
description: 上一篇留的坑——S-101 图示表达目录里 215 个规则文件只有"引用"，公开分发件里没有逻辑。这篇拆开官方的 Lua 条件制图规则：属性换符号、几何换画法、雷达叠加换图层、共边判定安全等深线，以及 S-111/S-123 为什么改用 XSLT。
tags: S-101, 图示表达, Lua, ECDIS, IHO
draft: true
---

上一篇[拆 PC 分发件](s101-portrayal-lookup.html)时留了个坑：目录里登记着 215 个规则文件的"引用"，但解开包只看到数据——符号怎么画有 XML，颜色怎么配有 colorProfile，**唯独没有"什么条件下画什么"的逻辑**。S-52 时代的 Look-up 表好歹是一张能读的表，S-101 把它变成了 215 个 Lua 文件——210 个物标规则，外加 5 个 `PortrayalAPI`、`S100Scripting` 之类的框架与公共文件。

这些文件不在图示表达包里，而是以 CSP（Conditional Symbology Procedure，条件制图程序）源码的形式随产品规范发布——IHO 官网上各产品规范的 Portrayal 附件里就能下到。本文拆的这批，对应 **S-101 Ed 2.0.0 配套的图示表达目录 v2.0.0**——215 个 Lua 文件逐个实读，数目正好与目录登记对上。这件事的分量值得单独说一句：**条件制图从"给人读的文档"变成了"给机器跑的程序"**。S-52 PresLib 时代，PL 3.4 / PL 4.0 里的条件逻辑是伪代码，每家渲染器自己翻译成 C++——翻译过程就是实现分歧的温床。S-101 干脆把官方实现（Lua）连同文档一起发，你要做的不是"照着文档写"，而是"把这段 Lua 嵌进去跑"。

这篇把其中的代表拆开看：一个最小的，一个最烧脑的，最后看一族不用 Lua 的。

## 最小的规则：锚泊船

`AnchorBerth.lua` 全文 43 行，是理解 CSP 结构的好样本。核心判断只有两处：

```lua
local symbol = 'ACHBRT07'	-- default for categoryOfCargo != 7

if contains(7, feature.categoryOfCargo) then
	symbol = 'ANCBDNG2'
end
```

第一个条件就值得停下：**属性直接改写符号**。锚泊船装的是危险品（categoryOfCargo 含 7），符号从普通锚泊换成危险品锚泊标——船员扫一眼符号就知道这片锚地里混着危险品船。这行代码在 S-52 里对应 Look-up 表里的一条带条件的行，语义没变，只是载体从表行变成了 if。

几何类型分支是第二处：

```lua
if feature.PrimitiveType == PrimitiveType.Point then
	...
elseif feature.PrimitiveType == PrimitiveType.Surface then
	...
	featurePortrayal:SimpleLineStyle('dash',0.64,'CHMGF')
	featurePortrayal:AddInstructions('LineInstruction:_simple_')
```

点要素给符号，面要素除了符号还要画边界——边界不引用外部线样式文件，而是用 `SimpleLineStyle` 内联一条简单的虚线（0.64 宽、CHMGF 浅品红）。S-52 里这个区分写在 Look-up 表的两个不同条目里，现在变成了显式的 if-else。

还有一处容易被忽略但很关键：

```lua
if contextParameters.RadarOverlay then
	featurePortrayal:AddInstructions('ViewingGroup:26220;DrawingPriority:15;DisplayPlane:OverRadar')
else
	featurePortrayal:AddInstructions('...DisplayPlane:UnderRadar')
```

`contextParameters` 是**船员设置**，不是要素属性。雷达叠加开着，锚泊符号画在雷达图像上层；关着就画在下层。同一个物标，画面层级跟着用户参数走——这就是为什么渲染器没法把"画在哪层"写死，也是 CSP 签名里带 `contextParameters` 的原因。要素属性、几何类型、用户上下文，三股输入在这里汇合。

最后一个小细节：要素带名字时，规则追加一条文本注记，且内容走模板——`EncodeString(GetFeatureName(feature, contextParameters), 'Nr %s')`。图上"Nr 7"这样的锚泊编号格式，是规则里定的，不是渲染器拼的。连一个前缀字符串的归属都被规范收走了。

顺带看一眼指令协议本身：`AddInstructions` 吃一个分号分隔的字符串，`ViewingGroup:26220;DrawingPriority:15;DisplayPlane:UnderRadar`——分组、优先级、显示面，一条指令流。**渲染器要做的只是实现这个指令集的解释器**，规则怎么写它一概不关心。

![条件制图流水线：三股输入汇入规则，产出指令流，渲染器只做解释](assets/fig-s101-flow.svg)

## 最烧脑的规则：深度区和它的邻居们

`DEPARE03.lua` 有 150 余行，处理的是海图上最要命的问题：**安全等深线到底画在哪**。

[前文讲过](s52-portrayal.html)，安全等深线是船员按吃水设的参数，改一个数整张图的填色分布重算。"重算"在 S-101 里的实体就是这段 Lua：

```lua
if depthRangeMinimumValue < contextParameters.SafetyContour then
	unsafe = true
else
	safe = true
end
```

水深小于安全等深线，这片深度区标记为 unsafe——但真正的重头戏在后面。深度区画边界时，要判断"我这条边是不是安全等深线"，而判断依据不是自己的属性，是**邻居是谁**：

```lua
for curveAssociation in feature:GetFlattenedSpatialAssociations() do
	local associatedFeatures = curveAssociation.AssociatedFeatures
	...
```

DEPARE03 遍历自己每条共享边，把共边的要素捞出来分堆：共边的是 `DepthContour`？看它的深度值是不是恰好等于安全等深线（`loc_safety`）。是 `LandArea`、`UnsurveyedArea`？那要看对方的水线效果（`waterLevelEffect`）——陆地和未测量区贴着的边按 unsafe 处理。连内陆水域都有特判：River、Lake、Canal、DockArea、LockBasin 算一组，还要看线性建筑物的水线效果属性。

这段代码里埋着一句真实工程味的注释：

```lua
-- NOTE: S-52 PL 3.4 disagrees with PL 4.0.1 on the inlandWaterShared and watlev.
--       Going with 3.4 since 4.0.1 doesn't apply the proper weight when safe water is
--       next to a land area.
```

S-52 预库 3.4 版和 4.0.1 版在内陆水域的判定上**标准自己打架了**，官方实现选边站 3.4，理由写在注释里。条件制图程序化的一个意外好处就在这：实现分歧没法再藏在各家 C++ 里，它被显式地摆在了代码注释中，型式认可时审的就是这一行。

DEPARE03 里还有两处值得圈出来。其一，位置质量直接映射到线型：

```lua
if qualityOfPosition and qualityOfPosition ~= 1 and qualityOfPosition ~= 10 and qualityOfPosition ~= 11 then
	featurePortrayal:SimpleLineStyle('dash',0.64,'DEPSC')
```

这条边如果位置测量质量不达标（qualityOfPosition 不在可信值列表里），安全等深线画成**虚线**——测得不准的等深线在图上就该长得不确定。数据质量参与渲染决策，这是 S-100 系列相对 S-57 最实质的进步之一，而它就落在这几行里。

其二，规则是可组合的。文件头 `require 'RESCSP03'`、`require 'SAFCON01'`、`require 'SEABED01'`——管制区注记、安全水深标注、海床显示各是独立的 CSP，被 DEPARE03 按需调用。215 个规则文件不是 215 个孤立函数，是一张调用网。连性能桩都标准化了（`Debug.StartPerformance('Lua Code - DEPARE03')`），官方实现自带计时。顺带一提，长度上的冠军另有其人——碍航物 OBSTRN07.lua 有 188 行，沉船、适淹礁、水线效果的多层嵌套判成迷宫；不过读懂了深度区，其它规则都是它的变奏。

## 另一族：不用 Lua 的 XSLT

Lua 不是唯一载体。S-111 表面流、S-123 海上无线电服务这批产品规范的图示表达，用的是 **XSLT**——规则文件长这样（S-123 的海警站，42 行）：

```xml
<xsl:template match="CoastguardStation[@primitive='Point']" priority="1">
  <pointInstruction>
    ...
    <viewingGroup>12310</viewingGroup>
    <displayPlane>OVERRADAR</displayPlane>
    <symbol reference="CostGuardStattion"/>
  </pointInstruction>
  <xsl:if test="communicationChannel!= ''">
    <textInstruction>...</textInstruction>
  </xsl:if>
</xsl:transform>
```

对比 AnchorBerth 那段 Lua，语义一一对应：模板匹配管几何类型（`[@primitive='Point']`），`xsl:if` 管条件注记，输出的是指令 XML 而不是指令流字符串。一个是命令式（Lua 主动 AddInstructions），一个是声明式（XSLT 匹配后产出 XML），条件制图的语义是同一套。顺带一个彩蛋：注意引用里那个 `CostGuardStattion`——双写的 t，官方分发件原样带着这个拼写错误。同一个包里还有拼错的 `Meterorological` 文件名（少个 o 的版本和正确版本并存）——一个 S-123 包贡献两处拼写彩蛋，标准是工程产物这件事，在细节里到处都是实锤。

为什么两套并存？XSLT 是 S-52 预库时代就确立的技术路线，这批产品规范延续了它；S-101 较新，规则换成了 Lua。但血统是一致的——S-131 的线样式文件头里照样写着 `source="S52Preslib4.0"`（下一篇细看这个文件），PresLib 的符号资产在新框架里继续服役。对我们做渲染器的人，实际含义是：**解析器要么支持两种规则引擎，要么在接入不同产品规范前先做一层转换**。我们的做法是工具里双引擎并列：同一个 S-131 分发包实测吃下 41 个 Lua 规则，S-123 分发包实测吃下 26 个 XSLT 规则文件（87 个 XML、657 个符号，覆盖 11 个物标），两条管道各自出渲染预览。

## 这件事的真正含义

把逻辑标准化成可执行程序，改变的不只是写法：

**渲染器退化成解释器**。指令集（ViewingGroup / PointInstruction / LineInstruction / …）成为唯一稳定接口，规则包整体可替换——IHO 发新版 PC，换包不换码。对照 S-52 时代"每家把 Look-up 翻译进 C++"，升级一次预库等于重新翻译一次。

**实现分歧无处可藏**。3.4 对 4.0.1 的取舍写在官方源码注释里，谁跟谁不一致、跟了谁，全都可查。型式认可审"显示对不对"时，审的不再是"你按文档理解对了吗"，而是"你跑的是不是这段代码"。

**测试有了锚点**。S-64 的官方测试数据集为什么能当"标准答案"，[前文](s64-test-datasets.html)说过；现在补上另一半——数据集喂进来，规则跑出去，两侧都是标准件，对不对得上，逐条可比。

规则文件、绘图资源、颜色配置三样凑齐，渲染器才算拿到了完整的"画法"。想亲手翻这 215 个规则？[工具页的 PC 解析器](pc.html)支持上传整个分发包目录：每个物标的渲染预览、规则源码、符号实图都在里面，S-101 和 S-123 的包都能直接吃。

下一篇进 S-131：港口基础设施产品——S-100 的产品谱系从"航海"走向"港口运营"，连系船柱和岸电设施都成了物标。图示表达规则换到新场景里怎么组织，[本篇双引擎实测](pc.html)用的那个 S-131 PC 2.0.0 分发包到时候正好登场。

---

我是夜航海图，做海图与地图渲染开发的工程师。博客「航图笔记」同步更新全部文章，欢迎 RSS 订阅。
