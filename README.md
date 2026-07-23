# ComfyUI-Workflow2PNG

一个纯前端的 ComfyUI 自定义节点插件，把工作流画布（节点、组、连线）导出为带透明背景的 PNG 图片。

---

## 功能特性

- **顶部工具栏按钮**：动态显示“导出 PNG（全部）”或“导出（已选择）”。
- **右键菜单导出**：选中节点或框组后，在画布或节点上右键，选择“导出选中为 PNG”。
- **1X–5X 倍数选择**：支持 1X / 2X / 3X / 4X / 5X 导出倍率，倍数越高图像越清晰、文件越大。
- **透明背景**：导出的 PNG 保留 Alpha 通道，方便二次合成。
- **文本域渲染**：导出时会将 ComfyUI 的 DOM 文本域（如 CLIP 文本编码器）内容绘制到 Canvas 上，保证截图完整。
- **自动降级保护**：浏览器 Canvas 单边硬上限为 16384px，当导出尺寸超过上限时会自动降到能容纳的最大整数倍率。
- **兼容老版本 ComfyUI**：支持 ComfyUI frontend >= 1.15.x，包括 1.28.8。

---

## 安装方法

### 方式一：ComfyUI Manager 安装（推荐）

在 ComfyUI Manager 中搜索 `ComfyUI-Workflow2PNG` 并点击安装。

### 方式二：Git 克隆

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/designex/comfyui-workflow2png.git
```

然后重启 ComfyUI。

### 方式三：手动安装

1. 下载本仓库源码。
2. 将文件夹复制到 `ComfyUI/custom_nodes/comfyui-workflow2png`。
3. 重启 ComfyUI。

---

## 使用说明

### 1. 顶部工具栏按钮

安装并启动 ComfyUI 后，在顶部菜单栏会出现一个按钮：

- 未选中任何节点/组时显示：**导出 PNG（全部）**
  - 点击导出整个工作流。
- 选中节点或组后显示：**导出（已选择）**
  - 点击只导出当前选中的节点/组。

按钮使用的导出倍数由设置面板中的 `Workflow2PNG — 导出倍数` 控制。

### 2. 右键菜单导出

1. 用鼠标框选或 Ctrl/Shift 点选需要导出的节点/组。
2. 在画布空白处或任意选中的节点上**点击右键**。
3. 选择菜单中的 **导出选中为 PNG**。
4. 在子菜单中选择 **1X / 2X / 3X / 4X / 5X** 之一即可导出。

> 未选中任何节点时点击该菜单会提示“请先选中一个或多个节点/组”。

### 3. 设置面板

进入 ComfyUI 设置（Settings）：

- 找到 **Workflow2PNG — 导出倍数**
- 可选项：`1X`、`2X`、`3X`、`4X`、`5X`
- 默认值：`1X`

该设置仅控制**顶部工具栏按钮**的默认导出倍数；右键菜单可临时选择任意倍数。

> 提示：浏览器 Canvas 单边硬上限为 16384px。如果工作流很大，即使选择 5X，实际导出时也会自动降级到 1X–5X 范围内能容纳的最大整数倍。

---

## 项目结构

```
comfyui-workflow2png/
├── __init__.py           # ComfyUI 扩展入口，声明前端资源目录
├── pyproject.toml        # 包元数据（PEP 621）
├── js/
│   └── workflow2png.js   # 前端扩展核心逻辑
└── README.md             # 本文件
```

---

## 兼容性

- ComfyUI frontend >= 1.15.x
- 已测试：ComfyUI 0.3.67 + frontend 1.28.8
- Python >= 3.10

---

## 开源协议

MIT License
