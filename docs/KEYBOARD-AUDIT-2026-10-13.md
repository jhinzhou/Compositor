# 快捷键修复与验收，2026-10-13

本批检查上游 `87e2283bae4cea45b857a1bb386f8a56ad4e99b6` 的 `Compositor/UI/KeyboardShortcuts.swift`，并修复 Electron 的快捷键归一化、配置加载和现有 `ShortcutSettings.vue` 弹窗。原文件已备份在 `artifacts/keyboard-audit-baseline/src/renderer/`。本批不操作用户应用或配置，不以源码测试代替真实桌面或 Windows 硬件验收。

## 上游行为与本批实现

| 行为 | Electron 本批实现 | 验收 |
| --- | --- | --- |
| 上游允许清除一个默认快捷键，保存后原组合不再回退触发 | 独立 Clear 按钮保存显式空字符串；Reset 删除覆盖；Restore Defaults 清空覆盖 | 清除 Undo 后原键可给另一个命令，保存/重载仍保持空字符串；实际弹窗处理函数覆盖清除、重置 |
| 上游加载时只丢弃失效的条目 | 丢弃删除的命令、非法键、系统保留键或重复键，保留其他配置；重复键按 command id 排序，赢家稳定；同时有效的互换仍保留 | 混合失效项、JSON 插入顺序变化、互换、失效覆盖恢复默认后的连带冲突 |
| 上游修复 Delete 原始字符与菜单匹配 | Electron 使用有名键 `backspace` / `delete`，两者保持不同；录制器不再把任何 Delete 都当作清除 | 实际录制 bare Delete、bare Backspace、Option+Delete、Command+Backspace；独立 Clear 按钮 |
| 上游文字编辑键必须带 Command、Control 或 Option | `text:*` 禁止裸键及仅 Shift；一般 Cancel 命令保留 Escape | 配置验证、加载隔离、弹窗禁止保存不合法文字键 |
| 上游忽略没有字符的 dead key | 忽略 Dead、Unidentified 和 IME composing；macOS Option 生成字符时恢复可用的字母/标点 code | dead/IME 不结束录制；Option+B 与 Option+Command+[ 匹配 |
| 上游 CMYK Proof Colors、Gamut Warning 可自定义且无默认键 | 不伪造未接入的命令；需已有实际 proof/gamut action 后添加 registry id | 此项由主任务接入；本快捷键模块可对无默认键命令保存/清除 |

Adobe 官方的快捷键设置说明确认设置入口可用 macOS Command+Option+Shift+K / Windows Ctrl+Alt+Shift+K；官方自定义说明也区分清除某个命令的快捷键、恢复或保留修改。这些依据支持本批的独立 Clear 行为。[当前设置入口](https://helpx.adobe.com/photoshop/desktop/get-started/settings-and-preferences/view-keyboard-shortcuts.html)、[官方自定义及清除说明](https://helpx.adobe.com/photoshop/using/customizing-keyboard-shortcuts.html)。

## Photoshop 方案新增默认

`Primary` 在 macOS 为 Command，在其他平台为 Ctrl。仅对实际 registry 已有命令设置默认，不创建虚假入口；Compositor 方案保持原默认。

| command id | 默认组合 | 证据边界 |
| --- | --- | --- |
| `reselect` | Primary+Shift+D | 重新选择由主任务接入；本批验证配置与冲突，不声称真实按键验收 |
| `grid` | Primary+' | 当前 Adobe 官方对齐工具说明明确给出此组合 |
| `guides` | Primary+; | 当前 Adobe 官方对齐工具说明明确给出此组合 |
| `filter:hsl` | Primary+U | 常用既有 Photoshop 组合；本机原生菜单检查确认 Hue/Saturation 命令存在，本批未逐个按键实测 |
| `filter:colorBalance` | Primary+B | 同上，原生 Color Balance 命令存在 |
| `filter:blackWhite` | Primary+Alt+Shift+B | 同上，原生 Black & White 命令存在 |

网格和参考线的组合由 [Adobe 当前官方说明](https://helpx.adobe.com/photoshop/desktop/use-grids-measurement-guides/alignment-grids-guides/show-or-hide-guides-grids-and-smart-guides.html) 核实。该页将 Primary+Shift+; 写为 Smart Guides，不能把它用作 Snap 的证据。本批保守保留 `snap`、`lock-guides` 的自定义入口，不新增其默认键。

[Adobe 官方快捷键 PDF](https://helpx.adobe.com/content/dam/help/en/photoshop/using/default-keyboard-shortcuts/photoshop-keyboard-shortcuts.pdf) 可支持本次 Delete/Backspace 区分、前景/背景填充、工具组 Shift 切换及功能键基础规则。该 PDF 仍含旧插件条目，未提供本次需要的全局 Snap / Lock Guides 表，也不代替当前软件逐键验证。Camera Raw 本机插件菜单状态不足以支持新增快捷键，本批未新增。

## 持久化与平台接口

存储键继续为 `compositor.shortcuts.v1`，覆盖值继续为字符串或显式空字符串，兼容既有存储。`normalizeChord` 保持平台无关；新增 `normalizePlatformChord` 将 macOS 的 Meta 或其他平台的 Ctrl 规范到 Primary，同时拒绝重复的同一物理修饰键。`commandForKey` 自动采用实际平台匹配，避免可显示但无法触发的别名，以及 Primary 与显式 Meta/Ctrl 的重复冲突。

以下 API 只增加末尾可选参数，原有 overrides 参数位置保持：

```ts
normalizePlatformChord(chord, platform?)
shortcutFor(command, overrides = {}, platform?)
shortcutProblem(commands, overrides, platform?)
loadShortcuts(storage, commands, platform?)
saveShortcuts(storage, commands, overrides, platform?)
```

启动时用实际已知 command id、去掉默认 shortcut 的 registry 加载覆盖；随后 `profileCommands` 按当前方案与有效覆盖计算默认，允许自定义覆盖占用原默认组合。保存仍拒绝自定义间冲突。App 保存前须用新 overrides 计算 profile，而不能用仍基于旧覆盖的 commands。

弹窗新增可选 `defaultCommands` 属性接收 raw registry，仅用其默认 shortcut，显示标题保持 `commands` 中的本地化结果。它让当前草稿抢占默认、Reset、Restore Defaults 的预览与最终保存一致。Escape 取消录制，第二次 Escape 关闭弹窗；关闭后重新打开丢弃未保存草稿。弹窗停止向工作区冒泡键盘事件，原生菜单焦点路由由主任务负责。

## 验证边界

定向命令：`npx tsx --test tests/command-shortcuts.test.ts tests/shortcut-settings.test.ts tests/view-geometry.test.ts tests/photoshop-workflow.test.ts`。`command-shortcuts.test.ts` 还从实际 App SFC 提取 `rawCommands`、`canvasTools`，验证两个方案、两个平台映射的完整默认目录无重复 command id、无快捷键冲突。`shortcut-settings.test.ts` 执行实际 Vue SFC 的处理函数与响应式草稿，不复制录制器实现。

本批验证配置算法、真实组件处理函数及既有交互回归，并执行 `vue-tsc --noEmit`。未单独运行 GUI、构建、打包或全量 gate。macOS 系统保留 Command+Q、Command+,、Command+Option+M，其他平台另保留 Alt+F4；这不是所有操作系统、键盘布局、用户改绑的完整保留键表。非美式布局和功能键的系统设置仍需真实硬件验证。
