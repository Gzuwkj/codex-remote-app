# Codex Remote 0.4.0 图标与后台任务通知

## 功能

- 安装图标改用用户指定的 ChatGPT 图标，导入已保留 APK 的密度资源及 adaptive foreground 路径；白底、黑色图形，增加 adaptive 和 Android 单色图标资源。App 名称及包名仍为 Codex Remote / com.remoteapp.mobile。
- 配对后首次申请 Android 通知权限；连接信息页提供任务通知开关及系统通知设置。拒绝权限时显示关闭状态，不声称已开启。
- Android 原生 remoteMessaging 前台服务持有独立 WSS 连接，只收轻量完成事件，不转发整段聊天文字流。后台有一条低优先级、无声音的连接通知；任务完成或失败单独使用高优先级通知通道。
- 点击结果通知直接启动 MainActivity，保存目标 threadId，前台恢复及启动初始化后打开目标聊天。PendingIntent 不可变，按聊天 URI 区分路由，通知自动清除。
- Bridge 持久化已经观察到的活动任务及待确认完成事件；中转写盘后确认，断线重试按 threadId/turnId 去重。中转保留最近 200 个、七天内事件，手机持久化 cursor，断线恢复补发。首次开启从当前基线开始，不推送旧任务。
- 后台服务所需设备凭据使用 Android Keystore AES-GCM 加密保存；解除配对会停服务并移除该副本。主 App 原有凭据仍由 Keychain 管理。

## 实际 Android 验收

最终 production APK 0.4.0 / code7，安装到 API35 x86_64 模拟器，使用真实云中转与当前桌面 Codex。同一专用测试聊天为 01a1abe9-85da-7751-99d3-9c1aae69f3b8。

1. 系统首次权限弹窗点击拒绝；连接信息页显示“开启任务完成通知”。再次由开关申请，点击允许后显示已开启；dumpsys 确认 TaskNotificationService 为前台服务、remoteMessaging 类型，状态通知无声音。
2. App 输入等待 35 秒后回复 NOTIFY_040_BG_OK 的专用测试，离开聊天至列表，再按 Home 退到桌面。任务结束后系统通知栏显示“任务已完成”和正确聊天标题。点击通知，App 从列表进入该聊天，最终内容 NOTIFY_040_BG_OK、发送按钮与复制操作可见。桌面实时订阅确认同 ID、完整结果及 completed。
3. App 再发送等待 35 秒后回复 NOTIFY_040_REPLAY_OK 的测试，退后台后开启模拟器飞行模式。电脑完成、Bridge 已确认完成，手机离线时只有“网络中断，正在重新连接”，没有结果通知。恢复网络、保持 App 在后台后，通知补发成功；点击后最终内容与发送状态恢复正常。
4. 连接信息页关闭通知，服务从 dumpsys 消失、界面恢复开启按钮；再开启后服务恢复，旧的完成通知没有重复出现。
5. Android 桌面真实显示新 ChatGPT 图形，并由该图标打开本 App。

保留证据位于 E:/Codex/content/repos/remoteapp/artifacts/：launcher-040.png、notifications-040-background.png、notifications-040-opened.png、notifications-040-replayed.png、notifications-040-replay-opened.png。图片已人工查看。

26 项自动测试通过，包括已观察任务完成/失败与中断区别、Bridge 重启恢复、确认清理、Relay 持久游标与去重、WSS 通知连接历史补发/实时投递与设备撤销。根与手机 TypeScript、production 构建通过。

## 发布与使用

安装 [0.4.0 APK](https://daxuechengminiapp.site/codex-remote/downloads/codex-remote-0.4.0.apk)，覆盖原生产包，保留配对。允许系统通知后即可开启；在“更多操作 → 连接信息”管理开关和系统通知权限。云中转及本机 Bridge 已同步更新，watcher 启停规则保持原样。

APK 大小 34,801,680 字节；SHA256：ab0132baf3f85e540840b59df6cca029e8f852bd482ff3515907745612effb5a。公网整包下载哈希与本地一致；签名证书 SHA256 76111cf6a51a987f3279893a604713b795c62866398106ef8d9a6e0f97b456f8，与旧生产包相同。

图标来源：已静态分析的 ChatGPT Android 1.2026.300（用户指定），原包 E:/Codex/content/reviews/chatgpt-android-remote/originals/com.openai.chatgpt.apk；导入 res/mipmap-*-v4/ic_launcher.webp 和 res/drawable/ic_launcher_foreground.xml，前景颜色解析为黑色，没有复制官方登录或认证逻辑。

## 边界

通知覆盖 Bridge 已订阅、已观察到执行中的聊天。没有主动扫描并打开所有未访问的电脑聊天；主动停止不发“完成”通知。后续可扩展到桌面全局任务发现。

这版采用原生常驻连接，未接入厂商/FCM 离线推送。强行停止 App 后需重新打开；不能保证厂商省电杀进程、长时间 Doze 或关机断网时实时收到。真实 ARM64 手机、长时锁屏/Doze、进程实际被系统回收后的通知冷启动与真实失败任务通知尚未实测，当前不把代码分支或模拟器结果冒充这些验收。真实失败事件的路由由自动测试覆盖。

实现依据：[Android 前台服务类型](https://developer.android.com/develop/background-work/services/fgs/service-types#remote-messaging)、[Android 通知权限](https://developer.android.com/develop/ui/compose/notifications/notification-permission)。
