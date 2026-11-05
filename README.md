# Codex Remote

Android React Native 客户端、国内中转服务和 Windows 桌面 Bridge。当前版本仍在开发与验收中，不能作为“完整功能已对齐”的交付。

## 当前云端发布 0.4.0

已部署至用户指定云服务器，默认 WSS：`wss://daxuechengminiapp.site/codex-remote/ws`。

- [正式签名 APK](https://daxuechengminiapp.site/codex-remote/downloads/codex-remote-0.4.0.apk)；包名 `com.remoteapp.mobile`，ARM64+x86_64，内置 JS。
- 云中转通过既有 Nginx HTTPS 独立路径提供服务，`codex-remote.service` 开机自启。
- 本机登录项已注册 watcher，Bridge 随 Codex 桌面主进程启动/停止；仅关闭窗口但进程仍在运行时继续连接。
- 双击 `E:/Codex/content/secure/remoteapp/Open Codex Remote.cmd` 打开电脑配对控制页，显示配对码、确认手机与撤销授权。页面只监听本机，入口中不硬编码凭据。
- 云端真实配对、同会话收发/追加/停止/App 内重连已实测；0.3.1 另实测流式输出、断网恢复与公网 APK 哈希，24 项自动测试通过。实际关闭 Codex、强停 App/重启中转恢复、物理手机等未验收，详见 [云端记录](docs/cloud/index.md)和[响应验收](docs/streaming/index.md)。

生产打包：先运行 `./scripts/prepare-signing.ps1`（已有密钥不会替换），然后 `./scripts/build-android.ps1 -Task assembleProduction -Architectures 'x86_64,arm64-v8a'`。发布签名只读取本机受限配置；不要提交或分发私钥。

## 本机启动

需要 Node 22、Python 3、运行中的 Codex Desktop。Bridge 使用当前桌面本机 IPC，不启动第二个 Codex App Server，不需要手机登录 ChatGPT。

```powershell
cd E:/Codex/content/repos/remoteapp
npm ci
npm run relay
# 另一个终端
npm run bridge
```

Bridge 打印五分钟有效配对码。手机填写中转地址、配对码后，在 Bridge 终端输入打印出的 `approve <request-id>`；也可以 `reject <request-id>`。输入 `pair` 更新配对码，`revoke <device-id>` 撤销设备。配对码和凭据不要提交到仓库。

模拟器使用 `ws://10.0.2.2:8787`，或通过 `adb reverse tcp:8787 tcp:8787` 使用 `ws://127.0.0.1:8787`。生产中转必须配置 WSS。默认服务只监听 127.0.0.1。

`.state/` 存放 Bridge 凭据、已授权设备和命令执行记录，必须保持私有并持久化。删除执行记录会丢失防重复依据。不要多实例同时使用同一个状态目录。

## Android 开发

```powershell
cd E:/Codex/content/repos/remoteapp/apps/mobile
npm ci
npm start
# 另一个终端，配置 JAVA_HOME、ANDROID_HOME
npm run android
```

固定 React Native 0.81.5、React 19.1，使用 Android SDK 36、Build Tools 36.0.0、NDK 27.1.12297006、CMake 3.22.1 和 JDK 17。可选 `-I ../../../scripts/mirrors.gradle` 启用 Maven 镜像；不关闭 TLS 校验。

运行检查：根目录 `npm test`、`npm run typecheck`，手机目录 `npx tsc --noEmit`。这些检查不替代 Android 和桌面的真实界面验收。

## 接入边界

- 桌面版本适配使用 `\\.\pipe\codex-ipc` 的带长度帧和 thread follower 协议，来源为本机桌面程序的静态核查及实际请求。它是版本相关内部接口，不是官方稳定扩展承诺。
- 会话目录通过只读 SQLite 查询，实时内容和操作通过会话拥有者完成；不通过另一运行时 resume 同一聊天。
- 本轮已实测同会话读取、发送、停止、追加、真实中转配对和命令防重复。Android 交互验收结果另见验收记录。
- 已登记的本地项目可通过桌面 App Tools 新建聊天，并已在手机和桌面实测；可用时自动发现该桌面通道。完整分页、附件上传、离线推送及生物识别解锁尚未完成。无拥有者的会话会报错，不静默启动独立运行时。
- 审批与用户输入 API 尚需真实请求验收，不能认为有按钮即已验证。
- 只允许预览已订阅聊天明确引用的图片路径，不提供任意电脑文件读取或任意 shell 执行接口。

技术依据：[App Server](https://learn.chatgpt.com/docs/app-server)；APK 静态分析位于 `E:/Codex/content/docs/chatgpt-android-remote-analysis/index.md`。官方 App 不需要再次安装或运行。

## 本轮验收与测试 APK

测试 APK 是 `com.remoteapp.test` / 0.2.2-local-test，包含 ARM64、x86_64 和内置 JS，使用开发签名。最新文件：`E:/Codex/content/releases/remoteapp/20261105/codex-remote-0.2.2-local-test.apk`。安装后通过 `adb reverse tcp:8787 tcp:8787` 使用本机地址 `ws://127.0.0.1:8787`；真机公网连接需已部署的 WSS 中转。ARM64 仅完成构建与包结构检查，真实 Android 验收使用 x86_64 API35 模拟器。

0.2.2 增加历史聊天自动加载：未找到 owner 时，通过当前桌面 App Tools 打开同一个 threadId，待 owner 就绪后订阅；手机无须先手动去电脑打开。该路径可能切换电脑显示的聊天，纯后台加载未实现。手机实际冷会话打开与桌面同 ID 状态已验证，18 项测试通过。

0.2.1 修复正文电脑图片与文件链接：蓝色链接、正文图片加载/重试/全屏、文档预览、分块下载到手机 Downloads/CodexRemote。需要同时更新并重启 Bridge。设备只可读取当前聊天助手回复/工具明确引用的文件。模拟器另有旧开发包 com.remoteapp；其覆盖安装被自动审批拒绝，原生下载模块未升级，请勿混同测试包。

0.1 已实际操作配对、项目/聊天、新建聊天、发送、追加、停止、截图预览，以及断线、恢复、强制停止后保留草稿与待发送记录。0.2 按 APK 静态证据重写侧栏、聊天排版、输入框、工具详情与明暗主题，并重新实测主要消息操作、复制、离线队列及滚动恢复；保留配对凭据升级，未重新配对。12 项自动测试通过。UI 证据和验收见 `E:/Codex/content/docs/codex-remote-ui/index.md`，原实现边界见 `E:/Codex/content/docs/codex-remote-react-native/index.md`。

`deploy/` 的 Docker/Caddy 文件是独立主机模板，未执行验证。当前实际云服务器使用 `codex-remote.service` 和 Nginx 增量配置，已有 80/443 网关；在该服务器采用当前原生部署方案，见云端记录。设备与电脑凭据通过受控 SSH 传输，不在聊天中传递。

## 0.3.1 响应修复

生产 APK 更新为 [0.3.1](https://daxuechengminiapp.site/codex-remote/downloads/codex-remote-0.3.1.apk)，保留原配对授权。增量传输、刷新合并、未变聊天行缓存及历史加载管道重发现已上线，需同步更新 Bridge 和中转。专用 80 行输出在 Android 模拟器实测完成确认往返 727ms；详细方法、长会话与真机边界见 [响应验收记录](docs/streaming/index.md)。

## 0.4.0 图标与任务通知

安装图标已按用户要求使用 ChatGPT 图形。配对后允许系统通知，即可在后台接收已连接聊天的任务完成提醒，点击打开对应聊天；“连接信息”可关闭或打开。后台连接保留安静的常驻通知，断线恢复补发，强停后需重开。桌面图标、权限、后台通知、点击路由、飞行模式补发及开关均通过 Android 模拟器真实操作；26 测试通过。[发布与验收边界](docs/notifications/index.md)。
