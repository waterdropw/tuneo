# 对话角色头像 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 陪伴屏对话气泡旁增加微信式圆形头像（用户/孩子右侧、AI 左侧），AI 头像随年龄段切换。

**Architecture:** 用 `@expo/vector-icons` 的 Ionicons 图标做圆形头像；新增 `avatarIcon(role, ageMode)` 辅助函数映射图标名；对话渲染从「单个气泡 View」改为「`flexDirection: row` 的行 View 包裹头像 + 气泡」，用 `justifyContent` 控制左右对齐。

**Tech Stack:** React Native、TypeScript、`@expo/vector-icons`（Ionicons）。

## Global Constraints

- 仅改 `src/navigation/screens/Companion.tsx`。
- 图标来源 `@expo/vector-icons` 的 `Ionicons`（项目已依赖，`ConfigButton.tsx` 已有 import 先例）。
- 图标映射（Ionicons 实际存在的图标名）：用户/孩子 = `person`；AI = toddler `balloon` / child `happy` / auto `sparkles`。
- 头像圆形约 32×32；AI 用 `Colors.accent`（橙）底 + 白色图标，孩子用 `Colors.secondary`（灰）底 + 白色图标。
- 气泡 `maxWidth` 从 `85%` 下调到约 `75%`（给头像留空间）。
- 布局：AI 消息 `[头像][气泡]` 靠左；用户消息 `[气泡][头像]` 靠右。
- `ageMode` 从 `useCompanionStore()` 获取（组件已导入，无需新依赖）。
- 不引入图片资源、不做头像交互/动画。

---

### Task 1: 对话角色头像

**Files:**
- Modify: `src/navigation/screens/Companion.tsx`

**Interfaces:**
- Consumes: `useCompanionStore()` 的 `ageMode`（现有）；`ChatMessage.role`（现有 `"user" | "assistant"`）；`Colors`（现有）。
- Produces: 组件内新增 `avatarIcon(role, ageMode)` 函数（返回 Ionicons 图标名字符串）；新增样式 `messageRow` / `avatar` / `avatarImage`。

- [ ] **Step 1: 引入 Ionicons**

把 `src/navigation/screens/Companion.tsx` 顶部的 import 区（`import { MenuAction } from "@react-native-menu/menu"` 附近）新增一行：

```tsx
import { Ionicons } from "@expo/vector-icons"
```

- [ ] **Step 2: 新增 avatarIcon 辅助函数**

在 `ChatMessage` 类型定义（`type ChatMessage = { role: "user" | "assistant"; text: string; ts: number }`）之后，新增：

```tsx
function avatarIcon(role: "user" | "assistant", ageMode: AgeMode): keyof typeof Ionicons.glyphMap {
  if (role === "user") return "person"
  switch (ageMode) {
    case "toddler":
      return "balloon"
    case "child":
      return "happy"
    case "auto":
      return "sparkles"
  }
}
```

> 注意：`AgeMode` 类型已从 `@/stores/companionStore` 导入（组件顶部现有 import 已含 `AgeMode`）。

- [ ] **Step 3: 改写对话渲染为「头像 + 气泡」行布局**

把 `Companion.tsx` 里 `messages.slice(...).map((m, i) => { ... })` 的返回体，从：

```tsx
              return (
                <View
                  key={idx}
                  style={[
                    styles.chatBubble,
                    m.role === "user" ? styles.userBubble : styles.assistantBubble,
                  ]}
                >
                  <Text
                    style={[
                      styles.chatText,
                      m.role === "user" ? styles.userChatText : styles.assistantChatText,
                    ]}
                  >
                    {m.text}
                  </Text>
                </View>
              )
```

改为：

```tsx
              const isUser = m.role === "user"
              return (
                <View
                  key={idx}
                  style={[styles.messageRow, isUser ? styles.userRow : styles.assistantRow]}
                >
                  {!isUser && (
                    <View style={[styles.avatar, styles.assistantAvatar]}>
                      <Ionicons name={avatarIcon(m.role, ageMode)} size={18} color={Colors.bgInactive} />
                    </View>
                  )}
                  <View style={[styles.chatBubble, isUser ? styles.userBubble : styles.assistantBubble]}>
                    <Text
                      style={[styles.chatText, isUser ? styles.userChatText : styles.assistantChatText]}
                    >
                      {m.text}
                    </Text>
                  </View>
                  {isUser && (
                    <View style={[styles.avatar, styles.userAvatar]}>
                      <Ionicons name={avatarIcon(m.role, ageMode)} size={18} color={Colors.bgInactive} />
                    </View>
                  )}
                </View>
              )
```

- [ ] **Step 4: 新增样式并调整气泡 maxWidth**

在 `styles` 的 `chatBubble` 定义处，把 `chatBubble` 的 `maxWidth: "85%"` 改为 `maxWidth: "75%"`。

在 `chatBubble` 样式之前新增：

```ts
  messageRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginBottom: 8,
  },
  userRow: {
    justifyContent: "flex-end",
  },
  assistantRow: {
    justifyContent: "flex-start",
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  assistantAvatar: {
    backgroundColor: Colors.accent,
    marginRight: 8,
  },
  userAvatar: {
    backgroundColor: Colors.secondary,
    marginLeft: 8,
  },
```

> 注意：原 `chatBubble` 里的 `marginBottom: 8` 已由 `messageRow` 承担（气泡不再单独加 marginBottom），需从 `chatBubble` 移除 `marginBottom: 8`，避免双重间距。

- [ ] **Step 5: 从 chatBubble 移除 marginBottom**

把 `chatBubble` 样式中的 `marginBottom: 8,` 一行删除（间距改由 `messageRow` 的 `marginBottom: 8` 承担）。

- [ ] **Step 6: lint + tsc 校验**

Run: `npx eslint src/navigation/screens/Companion.tsx`
Expected: 无 error。

Run: `npx tsc --noEmit`
Expected: 无 NEW 错误（`Spectrum.tsx`/`notes.ts`/`AutoDetectBilingualAsrService.test.example.ts` 的既有错误与本任务无关，忽略）。

- [ ] **Step 7: 读回确认**

Read `Companion.tsx`，确认：
- 头像与气泡同行，用户右侧/助手左侧对齐正确；
- AI 头像随 ageMode 变化（balloon/happy/sparkles），孩子固定 person；
- 气泡 maxWidth 已下调、marginBottom 无双重；
- 未改动其他逻辑（对话历史、清空、加载等）。

- [ ] **Step 8: Commit**

```bash
git add src/navigation/screens/Companion.tsx
git commit -m "feat: 对话气泡增加微信式角色头像"
```
