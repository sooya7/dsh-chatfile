# dsh-chatfile

[![GitHub](https://img.shields.io/github/license/sooya7/dsh-chatfile)](https://github.com/sooya7/dsh-chatfile)
[![Release](https://img.shields.io/github/v/release/sooya7/dsh-chatfile)](https://github.com/sooya7/dsh-chatfile/releases)

DeepSeek Harness WebUI 插件：在聊天框中**拖拽或选择任意文件**上传到当前会话工作区的 `uploads/` 目录，并在输入框中自动插入路径引用，agent 可直接读取分析。纯图片拖拽仍走内置图片流程，互不干扰。

源码：https://github.com/sooya7/dsh-chatfile

## 功能

- 🖱️ **拖拽上传**：把任意文件拖进聊天框（页面任意位置均可），松开即上传
- 📎 **上传按钮**：输入框工具行新增「📎」按钮，支持多选
- 🧷 **状态条**：输入框上方显示每个文件的上传状态（上传中 / 成功 / 失败），成功后可下载、可移除
- ✍️ **路径引用**：上传完成自动在输入框追加 `[上传文件] uploads/xxx.pdf（名称，大小）`，发送后 agent 用普通文件工具即可读取
- 🖼️ **图片兼容**：纯图片拖拽仍然走内置图片流程（预览条 + 图片附件）；非图片 / 混合拖拽由本插件接管
- 🔒 **安全下载**：下载走不可猜测的随机 token 路由（无路径输入，无穿越面）；文件名/大小/类型均在 Host 校验，单文件上限 50MB
- 🛠️ **CLI**：内置命令行工具，管理构建 / 安装 / 重启 / 状态 / 文件（见下方「CLI」）

## 目录结构

```
src/
  index.ts          Host 半区：POST /chatfile/upload + GET /chatfile/download/<token>
  client/index.ts   Client 半区：拖拽捕获、📎 按钮、状态条、输入框引用
bin/cli.mjs         零依赖 CLI（build / install / status / restart / ls / upload）
build.mjs           esbuild 构建（host ESM + client ModuleLoader 单文件包）
cordis.patch.yml    组合补丁（插入 dsh-chatfile 插件行）
.github/            release 自动构建 workflow
```

## CLI

仓库自带零依赖 CLI（Node ≥ 18），全局安装一次即可随处使用：

```bash
cd dsh-chatfile
npm link          # 或 pnpm link --global
```

```bash
dsh-chatfile build      构建插件（host + client bundles 到 lib/）
dsh-chatfile install    安装/更新到 web profile（之后需 restart 生效）
dsh-chatfile status     检查服务与插件状态（进程 / 路由 / bundle 探测）
dsh-chatfile restart    重启 dsh web 服务（systemctl，失败则 SIGTERM 自动拉起）
dsh-chatfile ls         列出 uploads/ 文件（默认 <cwd>/uploads/，--dir 指定）
dsh-chatfile upload     复制本地文件到 uploads/（重名自动 -1；默认 <cwd>/uploads/）
dsh-chatfile help       帮助
```

示例：

```bash
dsh-chatfile install && dsh-chatfile restart
dsh-chatfile upload report.pdf 数据.xlsx
dsh-chatfile ls --dir /home/developer/dsh
```

## 构建

```bash
pnpm install
pnpm build
```

产物：`lib/index.js`（Host ESM 插件）、`lib/client.js`（浏览器单文件 bundle，由 web server 以 `/plugins/dsh-chatfile/client.js` 提供）。

## 安装到 Web profile

本地仓库方式：

```bash
dsh plugin --profile web add file:/绝对路径/dsh-chatfile
```

从 GitHub 安装：

```bash
dsh plugin --profile web add "git+https://github.com/sooya7/dsh-chatfile.git"
```

然后**重启 `dsh web` 服务**使组合生效（`dsh-chatfile restart`，或 `sudo systemctl restart dsh-web.service`）。重启后插件持久可用（刷新页面、重启进程均不丢失），与动态插件（session 级、进程重启即失效）不同。

## 工作原理

- Client 半区在 `document` **捕获阶段**监听拖拽事件：非图片文件 `stopPropagation` 拦截（内置图片流程是冒泡阶段监听，互不干扰）；`conversation.input.overlay / left / dock` 三个 slot 分别承载拖拽遮罩、📎 按钮、状态条。
- 文件以 base64 JSON POST 到 `/chatfile/upload`；Host 半区经 `sandboxPolicy.resolve({ session })` 解析会话工作区根目录，写入 `<workspace>/uploads/`（重名自动加 `-1` 后缀），字节数校验后返回路径与下载 URL。
- 输入框引用通过 slot 标准 prop `inputActions.setDraft` 写入，占位符 `[附件上传中：…]` 在上传完成后替换为最终引用，失败则回滚。

## License

MIT
