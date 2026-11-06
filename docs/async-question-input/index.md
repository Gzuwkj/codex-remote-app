# 异步问题选择与回答（0.5.3）

## 根因与静态证据

截图中的问题来自 request_user_input_async，挂载在 agentMessage.questions；普通同步输入来自 item/tool/requestUserInput，挂载在 state.requests。旧 Bridge 只透传 state.requests，且投影助手消息时丢掉 questions，导致手机没有入口。

本轮没有运行 ChatGPT。静态检查用户先前保留的 ChatGPT Android 1.2026.300 APK：

- classes3.dex 的 Lxla1 方法 k/l/m/n/o 对应 CodexRemoteToolUserInputOptionRow、QuestionContent、RequestCard、SubmitRow、UserInputPromptContent。DEX 指令确认选项 label/description、选中答案、输入字段及提交行。
- classes4.dex 的 Ln77.a 解析 send_user_message_question_reply 包装的单个或数组回复；Ln77.b 构造 request_user_input_async 问题标识。
- classes5.dex 的 Llhe0 包含 codexRequestUserInputAsync 与 codexRequestUserInputResponse，索引记录其他 async 转换入口。
- 当前桌面静态模块也使用 JSON.stringify(['request_user_input_async', item.id, index]) 作为 questionItemId，并将 questionItemId/question/answer 放进结构化用户回复。与测试会话真实快照核对一致。

原始 APK 与 DEX 分析保留于 E:/Codex/content/reviews/chatgpt-android-remote/；本轮证据为 analysis/user-input-053-strings.json、user-input-053-methods.json 和 user-input-*.dex.txt。没有复制官方私有中转认证，不承诺像素一致。

## 实现

Bridge 从助手消息的问题中生成待回答请求，并从已接受的用户/追加消息中解析结构化答案，移除已处理问题。运行结束后仍未回答的问题继续保留。同步请求继续使用既有输入 RPC；异步答案经当前桌面的 turn/start 或 turn/steer 路径发往同一聊天。

手机从输入框上方“需要你确认”进入：显示问题、可选择的单选行、选中状态、选项说明和自填输入。没有填写时禁止提交；提交时禁止重复点击，成功后显示同步状态；过期/重复提交提示已处理。关闭面板会保留尚未回答的问题。空列表有明确提示。聊天中的已发送回答显示可读问题与答案，不展示协议包装。

Bridge 提交前检查当前桌面快照中的问题标识，并阻止同一 Bridge 重复提交；不自动重试结果未知的写命令。不同端结果以桌面后续快照为准，并非跨所有桌面客户端的原子互斥保证。

## 验收

在专用 QA 聊天 01a1abe9-85da-7751-99d3-9c1aae69f3b8 中实际产生 request_user_input_async：

1. Android 生产 App 显示 1 项待回答；打开后选择“模拟器测试”，选中行和输入框更新。
2. 手机提交后卡片移除，当前桌面同一会话收到结构化答案并返回 QUESTION_INPUT_053_OK。
3. 再产生无预设选项的问题“输入测试标记”，在最终交付 APK 输入 FREEFORM_053_DEVICE 并提交；桌面同一会话返回 FREEFORM_INPUT_053_OK，手机显示可读答案和空待办提示。
4. 44 项自动测试通过，覆盖完成后仍待回答、标识稳定、结构化答案移除、未接受追加不提前移除、运行中追加/空闲开启同会话回合、过期与重复拒绝、可读文本。根目录和 Android TS 检查、生产构建通过。

实际路径为 Android 模拟器，并非实体手机。同步 requestUserInput 和审批在本轮没有重新动态触发，沿用既有协议；跨端竞态的所有时序也未做真机穷举。

## 交付

APK：https://daxuechengminiapp.site/codex-remote/downloads/codex-remote-0.5.3.apk

本机：E:/Codex/content/releases/remoteapp/20261106/codex-remote-0.5.3.apk；包名 com.remoteapp.mobile；versionCode=11；34835780 字节。

SHA256：bd2b1e2b572b1b34eb35e0a349526cfc4c714b5b07f49bbcdc80820d8e5747e9。

生产证书沿用 76111cf6a51a987f3279893a604713b795c62866398106ef8d9a6e0f97b456f8；完整公网下载校验一致。Bridge 已更新 0.5.3，中转维持 0.5.1。
