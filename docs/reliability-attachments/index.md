# Codex Remote 0.5.0：重连、三端日志、手机附件与会话状态

## 断连核查与结论

用户报告 App 暂时无法连接，随后自行恢复。核查时云端 health、WSS 中转、电脑 Bridge 与桌面 IPC 均在线，模拟器能够读取同一会话；服务日志没有对应崩溃，系统盘仍有空间。当前本机 DNS A 记录正确，没有发现业务域名的 AAAA 记录。原版本没有保留足够的三端连接日志，因此无法倒推出本次瞬断的唯一原因，不能把下述缺陷直接宣称为这一次的确定根因。

已用实际 RemoteClient 代码和可控 WebSocket 回调复现：手动重连后，旧 socket 迟到的 host 消息会把新运行时和在线状态覆盖。修复前测试 actual=old/expected=current，修复后通过。现在所有 socket 回调校验连接归属，替换连接会立即结清旧请求为结果待确认，写命令不自动重发。另增加 15 秒建立/认证超时、返回前台的应用层探测、6 秒探测无响应退役重连；前台空闲时定期探测，后台暂停 JS 心跳计时，避免 Android 调度暂停引起误判。后台通知仍由原生服务独立连接。

Relay 支持 connection.ping/pong 与能力协商，命令被拒绝时返回带命令 ID 的结果，避免只显示全局错误却让请求等待 35 秒。Bridge 增加连接握手超时和旧回调隔离。App 提示区分“网络中断”“正在连接中转”“电脑离线”。

## 三端诊断日志

日志包含时间、版本、进程/连接标识、命令 ID、方法、聊天 ID、运行时、认证/断开/心跳/重试、发送/中转/Bridge 接受/返回、耗时、异常类型、文件上传阶段与通知状态。手机命令 ID 对应中转/Bridge 路由 ID 的冒号后缀。流式历史只采样状态和字节数，不逐字记录。

- 电脑 Bridge：E:/Codex/content/repos/remoteapp/.state/logs/bridge.log；另保留 .1、.2，每份约 1MB。受限电脑控制页的“刷新诊断日志”可查看最近 128KB，接口使用既有本机令牌和同源校验。
- 云中转：/srv/codex-remote/state/logs/relay.log，同样轮转；结构化内容也输出 systemd journal，可用 journalctl -u codex-remote.service 查询。
- Android：私有目录 diagnostics/app.log，同样保留约 3MB；App“更多操作 → 连接信息 → 连接诊断与日志”查看并刷新。点击导出后保存到 Downloads/CodexRemote，系统可能自动加 .txt 后缀。Android 29 以下使用分享面板回退，尚未实测。

日志通过字段白名单排除令牌、密码、配对码、聊天正文、文件内容、命令参数和完整返回值，并移除 URL 凭据、query 与 fragment。保留聊天/命令 ID 等排查元数据，分享前仍应按使用场景选择接收人。后台 watcher 使用日志文件，避免把持续 stdout 累积到 ReadToEnd 内存缓冲中。

## 手机附件

聊天和新聊天输入框的加号增加“添加截图或图片”“添加手机文件”。使用系统文档选择器，不申请全盘或相册扫描权限。每条最多 5 个附件，每个最大 20MB；图片支持 PNG/JPEG/WebP。选择后有缩略图、名称、移除与预览；上传显示进度。

原文件从手机私有缓存按 256KB 分块，经 WSS 中转到当前电脑 Bridge 的 .state/uploads。云端不保存文件正文。上传按设备与随机 ID 隔离，校验 offset、重复块、大小与 SHA256；完成后传入同一桌面的 turn/start 或 turn/steer。已有聊天图片使用桌面实际支持的 localImage 输入；普通文件以当前电脑路径引用。新建聊天使用现有桌面创建工具的文本文件引用路径，不宣称其与已有聊天的原生图片输入完全相同。

附件草稿和待发送记录保存 ID/文件信息，恢复后可继续编辑；失去手机缓存时明确要求重选。成功后清除当前草稿附件，不自动重发结果未知的任务。历史消息显示文件名，不展示上传目录路径；本设备上传的图片和文本可从聊天入口预览。图片历史预览上限 6MB，文本上限 1MB，其余格式/大小提示电脑查看。读写均有设备归属校验，跨设备附件预览尚未实现。

## 会话列表状态

通过当前桌面的 list_threads 状态获取最近 50 个聊天及固定项，每 5 秒同步；不另起 Codex 进程。列表与侧栏显示真实 active 状态的 loading，“进行中”在完成后自动取消。离线时停止动画并提示状态待同步。数据库返回的更早聊天仍可打开，但不保证其包含实时状态；未知状态不伪装成正在运行。该元数据还可发现并订阅已在桌面运行的聊天，扩展后台完成通知的观察范围。

## 实际验收

最终生产包 com.remoteapp.mobile / 0.5.0 / code9，在 Android API35 x86_64 模拟器经真实云中转连接当前桌面运行时，专用聊天 01a1abe9-85da-7751-99d3-9c1aae69f3b8：

1. 手机系统选择器选择实际手机截图和文本文件，预览/上传后同一桌面聊天正确读出 FILE_050_OK 及截图最后一条回复标记；手机显示附件文件名和结果。图片与文本从历史消息入口都打开成功。
2. 使用随机验证码的新 PNG，验证码没有放入文字提示。通过手机选择并发送，要求不使用工具，最终答案与图中随机验证码完全相同；最终包内图片内容传递已验证。
3. 任务运行时列表中根聊天和专用聊天均出现 spinner/进行中，完成后专用聊天标记消失、根聊天仍保持运行，已保存前后截图。
4. 飞行模式下保留截图并保存消息到待发送记录；网络恢复、App 后台返回前台后，继续编辑并发送成功，桌面历史中该用户消息只有一份，最终为 ATTACHMENT_OFFLINE_050_OK。
5. 最终包再次断网，实际显示“网络中断，正在重连”，恢复网络并返回前台后重新连接，历史和结果保持完整。
6. App 内打开日志页并导出实际日志到 Downloads/CodexRemote，读取导出文件核对包含命令阶段、不包含真实 Bridge/admin 凭据或测试消息/文件正文。电脑 Edge 真实打开控制页、点击日志刷新并显示 Bridge 连接和命令记录；云中转已写出结构化日志。
7. 最终 APK 安装、签名核对通过，证书与原生产包相同。35 项自动测试、根/手机 TypeScript、production 构建通过。自动测试包含旧连接竞态、失活/握手超时、不重复执行、日志脱敏/轮转/鉴权、通知连接回归和上传续传/重复块/越权/完整性。

证据位于 E:/Codex/content/repos/remoteapp/artifacts/：attachment-050-before-send.png、attachment-050-result.png、attachment-050-local-preview.png、attachment-050-history-preview.png、attachment-050-offline-queue.png、list-050-active.png、list-050-completed.png、diagnostics-050-export.png、connection-050-offline-label.png、connection-050-recovered-final.png；vision-050-result.json 记录随机图识别通过及离线消息只执行一次。

真实 ARM64 手机、运营商网络切换、长时间 Doze/进程回收仍未实测；运行中追加附件、新建聊天附件、跨设备附件预览和 Android 29 以下日志导出没有真实验收。此次使用现有聊天完成核心发送路径，不把自动测试或源码分支冒充这些验收。

## 发布

- APK：https://daxuechengminiapp.site/codex-remote/downloads/codex-remote-0.5.0.apk
- 大小：34,833,364 字节。
- SHA256：4cfdd688968be7a164b1e34f22404662a9fbf7ff224664ac56179199534e2a30。
- 签名证书 SHA256：76111cf6a51a987f3279893a604713b795c62866398106ef8d9a6e0f97b456f8。
- 当前云端 release /srv/codex-remote/releases/20261106-050-final，原 release 保留；本机 watcher 启停方式不变，已加载最终 Bridge bundle。
- 源码：https://github.com/Gzuwkj/codex-remote-app（私有）。

直接覆盖安装，保留现有配对；无需清除 App 数据。后续连接异常可通过 App 导出日志，再与 Bridge/中转的同一命令 ID 对照排查。
