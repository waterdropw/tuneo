# 儿童多模态陪伴 — 对话角色头像设计文档

- 日期：2026-08-27
- 状态：已评审通过，待实现
- 前置：`2026-08-25-children-multimodal-companion-design.md`（语音版，已实现）
- 相关分支：dev

## 1. 背景与目标

陪伴屏的对话记录目前是纯文字气泡：用户消息靠右（白底白字）、AI 消息靠左（灰底白字），无头像区分。为贴近微信式聊天体验、增强「孩子 ↔ AI 伙伴」的角色存在感，在气泡旁增加圆形头像图标。

## 2. 范围

### 2.1 范围内

- 对话气泡旁加圆形头像（微信式：用户头像在右、AI 头像在左）
- 用户（孩子）用固定图标；AI 伙伴图标随年龄段（`ageMode`）切换
- 仅改 `Companion.tsx` 的对话渲染与样式

### 2.2 范围外

- 头像点击交互、动画
- 引入 PNG 图片资源
- 年龄段之外的动态图标（音色/情绪驱动）

## 3. 视觉来源

用 `@expo/vector-icons` 的 Ionicons 图标（项目已依赖 `@expo/vector-icons`，现有 `ConfigButton.tsx`/`RightButtons.tsx` 已用 Ionicons/Feather/FontAwesome5）。

### 图标映射

| 角色 | toddler（幼儿 2-6） | child（儿童 6-12） | auto（自适应） |
|---|---|---|---|
| AI 伙伴 | `teddy-bear` | `happy` | `sparkles` |
| 用户（孩子） | `person` | `person` | `person` |

## 4. 布局

```
AI 消息（左）:  [头像] [气泡]
用户消息（右）: [气泡] [头像]
```

- 头像：圆形，约 32×32，`borderRadius` 半圆；AI 用 accent 橙底 + 白色图标，孩子用 secondary 灰底 + 白色图标
- 气泡 `maxWidth` 从 `85%` 下调（给头像留空间），改约 `75%`
- 现有气泡用 `alignSelf`（flex-start/flex-end）控制左右，改为 `flexDirection: "row"` 包裹头像 + 气泡，用 `justifyContent: "flex-start" | "flex-end"` 控制对齐

## 5. 数据流

头像图标由 `m.role` + 当前 `ageMode` 决定：

- `m.role === "user"` → 固定 `person`
- `m.role === "assistant"` → 按 `ageMode` 查 AI 图标映射（`teddy-bear` / `happy` / `sparkles`）

`ageMode` 从 `useCompanionStore()` 获取（组件已导入）。

## 6. 组件改动

### 6.1 修改 `src/navigation/screens/Companion.tsx`

- 引入 `Ionicons`（`@expo/vector-icons`）
- 新增 `avatarIcon(role, ageMode)` 辅助函数，返回 Ionicons 图标名
- 对话渲染：每条消息改为 `View(flexDirection row)` + 头像 `View` + 气泡 `View`
- 新增样式：`messageRow`、`avatar`、`avatarIcon`（或内联）

## 7. 错误处理

无（纯展示改动，无异步/边界逻辑）。

## 8. 测试

- 真机目测：三种年龄段的 AI 头像不同、孩子头像固定、左右对齐正确、气泡不遮挡头像
- lint + tsc 校验

## 9. 明确不做的（YAGNI）

- 头像点击/长按交互
- 头像动画、情绪表情切换
- 图片资源头像
- 音色/情绪驱动的动态头像
