# 状态提示音与破冰 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 陪伴会话连接成功/出错断线时用系统震动反馈，并让 AI 在开场主动问候、沉默时主动破冰。

**Architecture:** 两处最小改动——`Companion.tsx` 的事件分发里加两处 `Vibration` 调用；`prompts.json` 三个年龄段的系统提示词各加「开场」与「沉默破冰」两条指令。无新增依赖、无新文件、无数据流变化。

**Tech Stack:** React Native 0.76（内置 `Vibration`）、TypeScript、JSON 配置。

## Global Constraints

- 无新增 npm 依赖；震动用 RN 内置 `Vibration`，不引入资源文件。
- 连接成功：`Vibration.vibrate(80)`；出错/断线：`Vibration.vibrate([0, 200, 100, 200])`。
- 提示词改动保留原有「读绘本 / 危险警示 / 保持安静」场景判断，只追加开场与沉默破冰。
- 三个年龄段（`toddler` / `child` / `auto`）都要改，措辞各自匹配年龄段语气。
- 验证方式为真机手动验证 + `npm run lint`；本改动无纯函数逻辑，不写单测（见 spec §6）。

---

### Task 1: 改 prompts.json 加开场问候与沉默破冰

**Files:**
- Modify: `src/config/prompts.json`

**Interfaces:**
- Consumes: 无（纯文本配置）
- Produces: 三个年龄段 prompt 字符串新增「开场」「沉默破冰」指令，供 `getCompanionInstructions(ageMode)` 读取（该函数不变）。

- [ ] **Step 1: 替换 `toddler` 的结尾句**

把 `toddler` 值末尾的
```
- 其他时候保持安静，耐心等小朋友先说话或提问，不要一直说个不停。
```
替换为
```
- 开场：对话刚建立时，主动用一句简单温暖的问候打招呼（如「你好呀，我们一起玩吧」）。
- 沉默破冰：如果小朋友好一会儿没说话，可以温柔地主动问一句（如「你在玩什么呀？」），但不要频繁打扰，破冰后继续安静等待。
- 其他时候保持安静，耐心等小朋友先说话或提问，不要一直说个不停。
```

- [ ] **Step 2: 替换 `child` 的结尾句**

把 `child` 值末尾的
```
- 其他时候保持安静，耐心等小朋友先说话或提问，不要一直说个不停。
```
替换为
```
- 开场：对话刚建立时，主动用一句友好、亲切的话打招呼（如「嗨，我们来聊点什么吧」）。
- 沉默破冰：如果小朋友好一会儿没说话，可以自然地主动问一句（如「你最近在玩什么呀？」），但不要频繁打扰，破冰后继续安静等待。
- 其他时候保持安静，耐心等小朋友先说话或提问，不要一直说个不停。
```

- [ ] **Step 3: 替换 `auto` 的结尾句**

把 `auto` 值末尾的
```
- 其他时候保持安静，耐心等孩子先说话或提问，不要一直说个不停。
```
替换为
```
- 开场：对话刚建立时，主动用一句亲切的话打招呼，语言难度匹配孩子。
- 沉默破冰：如果孩子好一会儿没说话，可以主动问一句，语言难度匹配孩子，但不要频繁打扰，破冰后继续安静等待。
- 其他时候保持安静，耐心等孩子先说话或提问，不要一直说个不停。
```

- [ ] **Step 4: 校验 JSON 合法性**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/config/prompts.json','utf8')); console.log('valid')"`
Expected: 输出 `valid`，无报错。

- [ ] **Step 5: Commit**

```bash
git add src/config/prompts.json
git commit -m "feat: 陪伴开场问候与沉默破冰提示词"
```

---

### Task 2: Companion.tsx 加震动反馈

**Files:**
- Modify: `src/navigation/screens/Companion.tsx`

**Interfaces:**
- Consumes: 既有 `handleEvent` 的 `session-updated` 与 `error` 分支（文件内已有，不改签名）。
- Produces: 连接成功轻震一次、出错/断线连震两次；`Vibration` 从 `react-native` 导入。

- [ ] **Step 1: 加 `Vibration` 导入**

把 `src/navigation/screens/Companion.tsx` 第 2 行的
```tsx
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput } from "react-native"
```
改为
```tsx
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Vibration } from "react-native"
```

- [ ] **Step 2: 连接成功分支加轻震**

在 `handleEvent` 的 `case "session-updated":` 分支里，把
```tsx
      case "session-updated":
        setStatus("listening")
        statusRef.current = "listening"
        break
```
改为
```tsx
      case "session-updated":
        Vibration.vibrate(80)
        setStatus("listening")
        statusRef.current = "listening"
        break
```

- [ ] **Step 3: 出错/断线分支加连震**

在 `handleEvent` 的 `case "error":` 分支里，把
```tsx
      case "error":
        teardown()
        setErrorMsg(typeof data?.message === "string" ? data.message : "连接出错")
        setStatus("idle")
        statusRef.current = "idle"
        break
```
改为
```tsx
      case "error":
        Vibration.vibrate([0, 200, 100, 200])
        teardown()
        setErrorMsg(typeof data?.message === "string" ? data.message : "连接出错")
        setStatus("idle")
        statusRef.current = "idle"
        break
```

- [ ] **Step 4: 跑 lint 校验**

Run: `npm run lint`
Expected: 无 error（若有与本改动无关的历史 warning 可忽略）。

- [ ] **Step 5: 真机手动验证**

在真机（iOS 或 Android）上：
1. 进入「儿童陪伴」，点「开始陪伴」→ 连接成功瞬间应轻震一下。
2. 制造断线（如关掉 Wi-Fi 或杀掉会话）→ 应连续震动两下。
3. 观察连接后 AI 是否主动问候；沉默一段时间后是否主动破冰（此条为 prompt 验证，见 spec §5）。

- [ ] **Step 6: Commit**

```bash
git add src/navigation/screens/Companion.tsx
git commit -m "feat: 陪伴连接成功与出错断线震动反馈"
```
