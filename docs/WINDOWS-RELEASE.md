# Compositor Electron 0.3.0-alpha.4：Windows x64 交付说明

当前交付是便携目录 `win-unpacked`。解压完整目录后，从该目录启动 `Compositor Electron.exe`；请保留同级 `resources`、DLL 和其他文件。这个包在 macOS 上交叉构建，已经完成 PE 架构、版本、模型、WASM、运行库文件和许可资源的静态检查。Windows 原生启动、渲染、文件对话框、MCP、RAW/HEIF 解码及主体选择仍待 Windows 实机验收。

## 主体选择所需的 Microsoft 运行库

主体与对象选择使用本地 ONNX Runtime。它需要 Microsoft Visual C++ x64 运行库，包括 `msvcp140.dll`、`msvcp140_1.dll`、`msvcp140_atomic_wait.dll`、`vcruntime140.dll`、`vcruntime140_1.dll`。本包不包含 Microsoft 安装程序或这些 DLL。

需要安装运行库时，在解压目录打开 PowerShell，执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\Install-VisualCppRuntime.ps1"
```

该命令只在本次 PowerShell 进程中允许执行本地脚本，不修改系统的长期执行策略。脚本从 Microsoft 官方服务器下载固定版本 **14.51.36247.0** 的 x64 Redistributable，检查 SHA256 与有效的 Microsoft Corporation Authenticode 签名，然后调用官方安装程序。安装程序可能请求 Windows 管理员授权。

下载校验 SHA256：

```text
843068991daaa1f73ad9f6239bce4d0f6a07a51f18c37ea2a867e9beca71295c
```

脚本完成后会核对两个注册表视图中的 x64 运行库版本和五个系统 DLL。下载、签名、安装或核对失败时会明确报错，不会继续冒充安装成功。退出码 3010 表示安装程序要求重启。之后重新启动 Compositor，导入图片并执行 Subject Selection；真实推理完成才构成主体选择的 Windows 运行验收。

如果已有可信的官方安装程序，可离线指定文件：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\Install-VisualCppRuntime.ps1" -InstallerPath "C:\Downloads\VC_redist.x64.exe"
```

同样会要求上述精确 SHA256 和有效 Microsoft 签名。其他版本可从 Microsoft 官方页面安装，但不会通过此脚本的固定文件校验。

官方说明与下载入口：

- [Visual C++ Redistributable 官方下载](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist)
- [Microsoft C++ 运行库部署方式](https://learn.microsoft.com/en-us/cpp/windows/choosing-a-deployment-method)
- [Microsoft C++ 运行库分发条款](https://learn.microsoft.com/en-us/cpp/windows/redistributing-visual-cpp-files)

## 项目打开与交付边界

在应用内使用 Open Project 打开 `.comp` 项目。便携目录不会向 Windows 注册 `.comp` 文件关联；双击项目的关联行为需要后续 Windows 安装包验证。本 alpha 版本没有 Authenticode 应用签名。

应用 EXE 的名称、0.3.0-alpha.4 版本信息和 Compositor 图标已写入 PE 资源。该资源修复保留了可执行代码、ASAR 归档和 Electron ASAR 完整性资源。它不替代 Windows 原生运行验收。

完成 Windows 原生验收时，至少检查：启动及高 DPI 画布、快捷键与对话框、项目保存重新打开、主体选择和取消、RAW/HEIF 导入、MCP 编辑事务，以及安装包的文件关联。具体操作结果应与静态检查结果分别记录。

## alpha.4 工程打开

Windows 的 `.comp` 是目录，PSD/PSB 是文件。Open Project 先选择工程目录或 Photoshop 文件；两种原生选择器的选项已在隔离 macOS 测试进程检查，实际 Windows 文件选择、编辑、恢复及字体仍待原生验收。
