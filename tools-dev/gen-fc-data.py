#!/usr/bin/env python3
# 从 S-100 FC XML 重新生成 assets/s100-fc/fc-data.js（gen 工具的数据源）
# 用法：python tools-dev/gen-fc-data.py   （默认读取内置 S-101 FC 2.0.0 样本）
# 关键点：ComplexAttribute 的子绑定元素名是 subAttributeBinding（不是 attributeBinding）
import json, re, sys
import xml.etree.ElementTree as ET

XML = 'assets/s100-fc/s101-fc-2.0.0.xml'
JS  = 'assets/s100-fc/fc-data.js'
if len(sys.argv) > 1: XML = sys.argv[1]

src = open(XML, encoding='utf-8').read()
root = ET.fromstring(src.encode('utf-8'))
def local(el): return el.tag.split('}')[-1]
def kids(el, name): return [c for c in el if local(c)==name]
def deep(el, name):
    out=[]
    for c in el:
        if local(c)==name: out.append(c)
        out += deep(c, name)
    return out
def txt(el, name):
    k = kids(el, name)
    return (k[0].text.strip() if (k and k[0].text) else '')
def typeOf(el):
    bindings = []
    for ab in deep(el, 'attributeBinding'):
        attr_el = (kids(ab,'attribute') or kids(ab,'complexAttribute'))
        ref = attr_el[0].get('ref') if attr_el else None
        if not ref: continue
        lower = (deep(ab,'lower') or [None])[0]
        upper = (deep(ab,'upper') or [None])[0]
        lo = lower.text.strip() if lower is not None and lower.text else '0'
        up = upper.text.strip() if upper is not None and upper.text else '1'
        if upper is not None and upper.get('infinite')=='true': up='*'
        pv = (kids(ab,'permittedValues') or [None])[0]
        pvs = [c.text.strip() for c in pv] if pv is not None else []
        bindings.append({'ref':ref,'mult':lo+'..'+up,'pvs':pvs})
    infos = []
    for ib in deep(el, 'informationBinding'):
        attr_el = (kids(ib,'information') or kids(ib,'complexInformation'))
        ref = attr_el[0].get('ref') if attr_el else None
        if not ref: continue
        lower = (deep(ib,'lower') or [None])[0]
        upper = (deep(ib,'upper') or [None])[0]
        lo = lower.text.strip() if lower is not None and lower.text else '0'
        up = upper.text.strip() if upper is not None and upper.text else '1'
        infos.append({'ref':ref,'mult':lo+'..'+up})
    return {'code':txt(el,'code'), 'alias':txt(el,'alias') or None, 'name':txt(el,'name'), 'attrs':bindings, 'infos':infos}
def listed(el):
    lv = (kids(el,'listedValues') or [None])[0]
    return [{'code':txt(v,'code'), 'label':(txt(v,'label') or txt(v,'definition') or '')} for v in kids(lv,'listedValue')] if lv is not None else []

featureTypes, informationTypes, simples, complexes = [], [], [], []
assocs, roles = [], []
for el in deep(root, 'S100_FC_FeatureType'): featureTypes.append(typeOf(el))
for el in deep(root, 'S100_FC_InformationType'): informationTypes.append(typeOf(el))
for el in deep(root, 'S100_FC_SimpleAttribute'):
    simples.append({'code':txt(el,'code'), 'name':txt(el,'name'), 'alias':txt(el,'alias') or None,
                    'vt':txt(el,'valueType'), 'values':listed(el)})
for el in deep(root, 'S100_FC_ComplexAttribute'):
    binds = []
    for ab in deep(el, 'subAttributeBinding'):
        attr_el = (kids(ab,'attribute') or kids(ab,'complexAttribute'))
        ref = attr_el[0].get('ref') if attr_el else None
        if not ref: continue
        lower = (deep(ab,'lower') or [None])[0]
        upper = (deep(ab,'upper') or [None])[0]
        lo = lower.text.strip() if lower is not None and lower.text else '0'
        up = upper.text.strip() if upper is not None and upper.text else '1'
        if upper is not None and upper.get('infinite')=='true': up='*'
        pv = (kids(ab,'permittedValues') or [None])[0]
        pvs = [c.text.strip() for c in pv] if pv is not None else []
        binds.append({'ref':ref,'mult':lo+'..'+up,'pvs':pvs})
    complexes.append({'code':txt(el,'code'), 'name':txt(el,'name'), 'alias':txt(el,'alias') or None, 'attrs':binds})
for el in deep(root, 'S100_FC_FeatureAssociation'):
    assocs.append({'code':txt(el,'code'), 'name':txt(el,'name'),
                   'roles':[r.get('ref') or '' for r in kids(el,'role')]})
for el in deep(root, 'S100_FC_Role'):
    roles.append({'code':txt(el,'code'), 'name':txt(el,'name'), 'type':txt(el,'roleType'),
                  'members':[m.get('ref') or '' for m in deep(el,'member')]})

data = {'featureTypes':featureTypes, 'informationTypes':informationTypes, 'simple':simples,
        'complex':complexes, 'assoc':assocs, 'roles':roles}
js = 'window.FC_DATA = ' + json.dumps(data, ensure_ascii=False) + ';'
open(JS, 'w', encoding='utf-8', newline='').write(js)
print(f'fc-data.js 已生成：要素 {len(featureTypes)} · 信息类型 {len(informationTypes)} · 简单属性 {len(simples)} · 复杂属性 {len(complexes)}（带子绑定 {sum(1 for c in complexes if c["attrs"])}）')
