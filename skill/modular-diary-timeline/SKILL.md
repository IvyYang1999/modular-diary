---
name: modular-diary-timeline
description: 编辑 Modular Diary Obsidian 插件的荧光笔时间轴块。当用户要求记录/规划时间花费、修改 daily 笔记里的 timeline 代码块时使用。触发词：时间轴、Modular Diary、timeline、记录时间、刚花了/刚用了 X 时间、规划今天。
---

# Modular Diary 时间轴编辑

Modular Diary 把时间轴存为 Obsidian 笔记里的 ` ```timeline ` 代码块。**markdown 源码是唯一事实源**：你只编辑代码块内部，插件会自动重新渲染。**绝不改动代码块以外的正文。**

## 语法总览

````
```timeline
date: 2026-08-18          # 可选；缺省取笔记日期
range: 7-23               # 可选；时间轴范围
width: 262                # 可选；时间轴区宽度 px（拖手柄会写回）
side: left                # 可选；时间轴栏在左（默认右）
hide: sleep misc          # 可选；本块隐藏的荧光笔类型
layout: text@0,0,6,12 toolbar@6,0,6,3 timeline@6,3,6,40   # 可选；组件网格布局（12列x20px行），通常由拖拽自动维护，别手写
---
plan 08:00-09:30 math 线代第一章      # plan 前缀 = 规划层（斜线纹理背景）
09:15-12:15 math 李林线代第一章·行列式  # 实际色块：HH:MM-HH:MM <type> [备注]
12:15-13:30 sleep 午休
@21:40 头晕，提前收工                  # @HH:MM = 点批注
===                                    # 可选；以下是自由 markdown 文字区
## 明日 to do
1. 李林线代讲义 第一章…
```
````

## 条目规则

- 24 小时制，粒度 15 分钟。**跨零点算当日**：早于 range 起点的时间（如 `00:30-01:30`）表示次日凌晨，仍属于这一天；轴向会自然延伸。
- 时长不需要写，渲染时自动算（如 `3.25h`）。
- 条目按开始时间升序排列。
- **允许重叠**：重叠的实际色块会并排分列渲染（并列日程），无需规避。
- type 必须是插件设置里登记的类型名（如 math/micro/english/sleep/meal/fitness/misc），拿不准用 `misc`。
- `===` 以下的文字区不参与解析，随便写 markdown。

## 工作流：用户说「我刚花了半小时健身」

1. 获取当前时间（`date "+%H:%M"`）。
2. 算属性：end=当前时间，start=往前推时长；「从 a 到 b」类描述直接用给定时间。
3. 选 type：对照类型表；用户历时常用类型优先，拿不准用 `misc`。
4. 找到目标笔记里的 ` ```timeline ` 块，按时间顺序**插入**一行 `HH:MM-HH:MM type 备注`。
5. 自检：时间格式合法、type 来自类型表；与已有色块重叠是允许的（并列日程）。

## 工作流：规划明天

在块内插入 `plan HH:MM-HH:MM type 备注` 行。plan 条目渲染为斜线纹理背景层，用户当天画实际色块覆盖。

## 边界

- 只编辑 timeline 代码块内部；块外正文一个字都不动。
- 没有 timeline 块的笔记：先问用户要不要新建（或提示用户：编辑器右键菜单/命令面板有「插入 Modular Diary 时间轴」入口）。
- `layout:` 头是组件拖拽的持久化，格式 `id@x,y,w,h`（slot 名：text/toolbar/timeline/stats/dialog）；用户拖过就别手改，没拖过就别加。
- 修改已有条目时保留原行格式（plan 前缀、备注），只改用户要求的部分。

## 对话框契约（供参考）

插件内置对话框走的是「Agent 只出 JSON、插件写回」路径。如果你被用作对话框后端，只输出 JSON：
- 新建：`{"start":"HH:MM","end":"HH:MM","type":"<type>","note":"<可省>"}`
- 修改：`{"action":"update","target":N, ...只给要改的字段}`（N = system prompt 里已有色块的编号）
- 删除：`{"action":"delete","target":N}`
- 多个操作混在数组里：`[{...},{...}]`
- 「刚刚/刚才那个」= 编号最大的。「我 X 点起床」→ sleep 块从时间轴起点到 X。
- 无法确定时间/时长时输出：`{"error":"<一句中文追问>"}`（用户会在同一对话里补充）
