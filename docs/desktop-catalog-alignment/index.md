# 手机会话与项目对齐桌面（0.5.2）

## 根因

旧 Bridge 的 catalog.py 从 state_5.sqlite 查询最近 100 条 archived=0 的记录，随后只合并桌面返回的运行状态，没有按桌面会话列表筛选。因此 CLI、隐藏测试等数据库记录进入手机列表。手机项目选择器又把所有未匹配到注册项目的 cwd 补为项目，导致 ti、wo-z 等历史目录与同名目录出现，和桌面不一致。

## 改动

- 会话来源改为当前桌面 list_threads，保留本机 codex 会话及置顶顺序，按 ID 去重，沿用桌面的标题、项目 ID 和运行状态；数据库只用于寻找调用桌面接口的初始上下文，不再对外提供会话列表。
- 桌面接口失败时返回错误，保留已有手机缓存，不回退到原始数据库列表。
- 项目选择器只显示桌面 list_projects 中注册的本机项目，删除按 cwd 推导项目的逻辑。
- 项目 ID 优先于目录路径，支持会话旧目录与项目当前目录不同的情况；会话标题优先使用桌面列表，避免历史标题缓存覆盖重命名。
- 使用新的 desktop-catalog-v1 缓存键，升级后不读取旧版混入隐藏会话的 catalog 缓存。Bridge 的目录事件发送完整桌面列表，手机替换而非仅合并运行态，更新新增、移除和改名。
- Bridge 0.5.2 已由现有随 Codex 启停的启动器加载；中转保持 0.5.1。Android 0.5.2/code10，需要安装新版以更新项目选择器。

## 验证

当前桌面返回 24 个本机 Codex 会话、7 个注册项目。真实 DesktopAdapter 返回的会话 ID 和桌面接口逐项一致；截图中的 HTTP_ONLY_OK、TUN_OK、PROXY_OK 测试记录为 0。桌面项目为远程连接app、小法律助企业微信助手、法官家、大学诚、dontstrave、proc、playground。

40 项测试通过（包括桌面来源、去重、项目标识、接口失败不回退数据库）；根目录和手机 TypeScript 检查通过，生产 APK 构建通过。

在 emulator-5570 的生产包 com.remoteapp.mobile 安装升级后，实际进入聊天列表及项目选择器：

1. 搜索 PROXY_OK，显示“没有找到聊天”。
2. 项目面板仅显示上述 7 项及“所有项目”，没有历史 cwd 项。
3. 选择小法律助企业微信助手，显示其“克隆并关联小法律助仓库”会话；该会话原 cwd 与项目当前目录不同，按项目 ID 正确关联。
4. 将专用 QA 会话临时改名为 CATALOG_SYNC_052_TEST，手机未手动刷新即可搜索到新标题，随后恢复原标题并确认手机恢复显示。
5. 最终交付包重新安装后复测项目选择与筛选成功。未删除、归档或清理用户历史数据。

实体手机安装与实体手机界面当前不可操作，未计作已验证；上述真实 App 操作来自现有 Android 模拟器。

## 交付

- APK：https://daxuechengminiapp.site/codex-remote/downloads/codex-remote-0.5.2.apk
- 本机：E:/Codex/content/releases/remoteapp/20261106/codex-remote-0.5.2.apk
- 包名：com.remoteapp.mobile；versionName=0.5.2，versionCode=10。
- SHA256：2db38ff70355e678070c996c45f0a15ff4e85171fbff7f7e9ccca2968bfa2028。
- 签名证书沿用既有生产身份：76111cf6a51a987f3279893a604713b795c62866398106ef8d9a6e0f97b456f8。
- 本机验收截图及测试日志位于 artifacts/catalog-052-*（不入库）。公网下载包单独校验 SHA256。
