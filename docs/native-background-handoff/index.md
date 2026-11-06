# 原生后台聊天缓存与前台恢复（0.5.4）

## 本轮确认的缺口

原生 TaskNotificationService 仅处理 host/completion，聊天进度仍由 React Native JS WebSocket 和页面更新逻辑处理；后台常驻通知存在，不等于 JS 正在更新聊天。旧 resume 使用原连接探测后刷新，如果连接还在 CONNECTING 则直接返回，前台可能继续显示原页面或处理积压事件。仅凭现象不能确认华为究竟暂停 JS、冻结进程还是限制网络。

## 调整

- MainActivity 原生 onPause/onResume 切换数据接收职责，JS 记录当前聊天标识，后台通知连接订阅该聊天并请求只读快照。通知服务已启用时，原生网络线程与 IO 执行器应用快照/增量并保存到应用私有目录，不依赖 React 渲染或 JS 定时器。
- 前台 JS 进入后台后取消自己的聊天流订阅，不继续向 React 交付进度；原生服务继续接收。回到前台时退出原生聊天订阅，通知连接继续保留。
- 后台缓存使用单线程写入、原子替换及运行中限频；完成等状态切换立即落盘。增量缺口触发只读快照恢复。缓存绑定 deviceId、epoch 和 threadId，JS 拒绝跨设备/运行时的缓存。
- JS 在后台超过 1 秒后返回前台，丢弃旧页面连接并重新认证，不继续消化旧连接积压。先尝试恢复匹配的原生缓存，认证后再读取当前桌面快照核对；不重发写命令。
- 页面同步时显示“正在同步最新状态…”，无网络时明确显示保存内容、正在重连和草稿保留。

## 实际验收

使用既有 emulator-5570 的生产包 com.remoteapp.mobile，安装最终 APK 0.5.4/code12。

1. App 打开专用 QA 聊天后按 Android Home。确认 launcher 位于前台，随后从桌面发起仅回复标记的安全测试任务。
2. 原生 notifications 日志在 foreground=false 时记录后台缓存 revision 542→548→551→553，并收到完成事件 cursor=23；说明新接收路径确实工作，而非只保留常驻通知。
3. 切回 App，记录 foreground-rebuild，随即 snapshot-restored revision=553；页面实际显示 BACKGROUND_HANDOFF_054_OK。桌面同一聊天已完成，结果一致。
4. 断开模拟器 Wi-Fi，回到 App 显示“无法连接中转”“正在显示已保存的聊天”，保留上次内容；恢复 Wi-Fi 后自动恢复连接。本轮没有自动重发聊天任务。
5. 46 项自动测试通过，新增长时间后台后替换旧连接/忽略旧帧，以及缓存设备、运行时和聊天绑定检查。根目录和手机 TypeScript 检查、生产构建、生产签名校验通过。

没有注入或修改用户业务任务，只使用专用 QA 聊天。模拟器上的 JS 没有被人为单独冻结；原生路径不依赖 JS 的结论来自代码职责分离及后台 IO 日志，不能宣称模拟器复现了华为的冻结行为。

## 边界

- 原生后台接管依赖任务通知服务已启用且进程可运行；目前只同步当前选中的聊天，完成通知保持原有范围。
- 如果华为冻结整个进程、禁止网络或强行停止应用，原生服务也不能继续执行。华为系统推送通道仍未接入，实体华为设备没有连接本机，不能宣称真机实时送达问题已解决。
- 本版没有新增永久唤醒锁、循环拉起进程或伪造系统服务；后台缓存会产生额外流量和磁盘写入，未作实体手机耗电测量。
- 返回前台仍保留原聊天与滚动位置；优化的是数据新鲜度，而不是强制跳到另一个页面。

## 交付

下载：https://daxuechengminiapp.site/codex-remote/downloads/codex-remote-0.5.4.apk

本机：E:/Codex/content/releases/remoteapp/20261106/codex-remote-0.5.4.apk；34836928 字节；SHA256=41adcb52819236f66fe621c9b6ad1bf765c874dad0a40cb7e4d0bcce48779c76。

包名 com.remoteapp.mobile；versionCode=12；证书 SHA256=76111cf6a51a987f3279893a604713b795c62866398106ef8d9a6e0f97b456f8。Bridge 仍为 0.5.3，中转为 0.5.1，本轮仅更新 Android 客户端。

证据在 artifacts/background-054-*、build-background-054-delivery.log 及 Android/Bridge 日志中，不包含到代码仓库。
