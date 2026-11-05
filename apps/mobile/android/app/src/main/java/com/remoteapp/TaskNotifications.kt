package com.remoteapp

import android.Manifest
import android.app.*
import android.content.*
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.*
import android.provider.Settings
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager
import okhttp3.*
import org.json.JSONObject
import java.security.KeyStore
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal object NotificationState {
  @Volatile var visible = false
  @Volatile var connected = false
  @Volatile var running = false
  fun prefs(c: Context) = c.getSharedPreferences("task_notifications", Context.MODE_PRIVATE)
  fun permitted(c: Context): Boolean = NotificationManagerCompat.from(c).areNotificationsEnabled() &&
    (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) &&
    (Build.VERSION.SDK_INT < 26 || (c.getSystemService(NotificationManager::class.java).getNotificationChannel("task_results")?.importance ?: 3) != NotificationManager.IMPORTANCE_NONE)
  private fun key(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey("remote_task_credentials", null) as? SecretKey)?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(KeyGenParameterSpec.Builder("remote_task_credentials", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
    return generator.generateKey()
  }
  fun saveCredentials(c: Context, text: String) {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key())
    val encoded = Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(cipher.doFinal(text.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
    check(prefs(c).edit().putString("credentials", encoded).commit())
  }
  fun credentials(c: Context): JSONObject {
    val parts = prefs(c).getString("credentials", null)!!.split(":")
    val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)))
    return JSONObject(String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), Charsets.UTF_8))
  }
  fun capture(c: Context, intent: Intent?) {
    val id = intent?.getStringExtra("notificationThread") ?: return
    if (Regex("[a-zA-Z0-9_-]{1,100}").matches(id)) prefs(c).edit().putString("openThread", id).commit()
    intent.removeExtra("notificationThread")
  }
}

class NotificationPackage : ReactPackage {
  override fun createNativeModules(c: ReactApplicationContext): List<NativeModule> = listOf(TaskNotificationModule(c), DiagnosticsModule(c), PhoneAttachmentsModule(c))
  override fun createViewManagers(c: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
class TaskNotificationModule(private val c: ReactApplicationContext) : ReactContextBaseJavaModule(c) {
  override fun getName() = "TaskNotifications"
  @ReactMethod fun status(promise: Promise) {
    val p = NotificationState.prefs(c)
    promise.resolve(Arguments.createMap().apply {
      putBoolean("enabled", p.getBoolean("enabled", false)); putBoolean("permitted", NotificationState.permitted(c))
      putBoolean("connected", NotificationState.connected); putBoolean("running", NotificationState.running)
    })
  }
  @ReactMethod fun configure(url: String, deviceId: String, token: String, promise: Promise) {
    Diagnostics.write(c, "notification.configure", JSONObject().put("url", url), role = "notifications")
    try {
      require(url.startsWith("wss://")) { "后台通知需要安全的中转地址" }
      require(NotificationState.permitted(c)) { "请先允许系统通知权限" }
      val previous = try { NotificationState.credentials(c) } catch (_: Exception) { null }
      if (previous?.optString("deviceId") != deviceId || previous.optString("url") != url)
        NotificationState.prefs(c).edit().remove("cursor").commit()
      NotificationState.saveCredentials(c, JSONObject().put("url", url).put("deviceId", deviceId).put("token", token).toString())
      NotificationState.prefs(c).edit().putBoolean("enabled", true).commit()
      ContextCompat.startForegroundService(c, Intent(c, TaskNotificationService::class.java))
      promise.resolve(null)
    } catch (e: Exception) {
      NotificationState.prefs(c).edit().putBoolean("enabled", false).commit()
      promise.reject("NOTIFICATION_START_FAILED", e.message, e)
    }
  }
  @ReactMethod fun disable(promise: Promise) {
    Diagnostics.write(c, "notification.disabled", role = "notifications")
    NotificationState.prefs(c).edit().putBoolean("enabled", false).remove("credentials").remove("cursor").commit()
    c.stopService(Intent(c, TaskNotificationService::class.java)); promise.resolve(null)
  }
  @ReactMethod fun consumeOpenThread(promise: Promise) {
    val p = NotificationState.prefs(c); val id = p.getString("openThread", null)
    p.edit().remove("openThread").commit(); promise.resolve(id)
  }
  @ReactMethod fun openSettings() {
    c.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, c.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  }
}

class TaskNotificationService : Service() {
  private val handler = Handler(Looper.getMainLooper())
  private val http = OkHttpClient.Builder().pingInterval(25, TimeUnit.SECONDS).connectTimeout(12, TimeUnit.SECONDS).build()
  private var socket: WebSocket? = null
  private var stopped = false
  private var generation = 0
  private var retries = 0
  override fun onBind(intent: Intent?) = null
  override fun onCreate() {
    Diagnostics.write(this, "notification.service-start", role = "notifications")
    super.onCreate(); NotificationState.running = true
    val manager = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= 26) {
      manager.createNotificationChannel(NotificationChannel("task_listener", "后台任务连接", NotificationManager.IMPORTANCE_LOW).apply { setSound(null, null); setShowBadge(false) })
      manager.createNotificationChannel(NotificationChannel("task_results", "任务完成提醒", NotificationManager.IMPORTANCE_HIGH).apply { description = "电脑任务完成或失败时提醒，点击打开对应聊天"; enableVibration(true) })
    }
    val notification = statusNotification("正在连接电脑任务通知")
    if (Build.VERSION.SDK_INT >= 34) startForeground(4100, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING) else startForeground(4100, notification)
  }
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (!NotificationState.prefs(this).getBoolean("enabled", false) || !NotificationState.permitted(this)) { stopSelf(); return START_NOT_STICKY }
    if (socket == null) connect()
    return START_STICKY
  }
  private fun statusNotification(text: String): Notification {
    val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    return NotificationCompat.Builder(this, "task_listener").setSmallIcon(R.drawable.ic_notification).setContentTitle("Codex Remote · 任务通知").setContentText(text).setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true).setSilent(true).build()
  }
  private fun connection(online: Boolean, text: String) {
    Diagnostics.write(this, "notification.connection", JSONObject().put("online", online), role = "notifications")
    NotificationState.connected = online
    getSystemService(NotificationManager::class.java).notify(4100, statusNotification(text))
  }
  private fun connect() {
    if (stopped) return
    val config = try { NotificationState.credentials(this) } catch (_: Exception) { stopSelf(); return }
    val current = ++generation
    Diagnostics.write(this, "notification.connecting", JSONObject().put("attempt", retries), role = "notifications")
    socket = http.newWebSocket(Request.Builder().url(config.getString("url")).build(), object : WebSocketListener() {
      override fun onOpen(ws: WebSocket, response: Response) {
        ws.send(JSONObject().put("type", "device.auth").put("deviceId", config.getString("deviceId")).put("token", config.getString("token")).put("snapshotDeltas", true).put("notificationClient", true).put("notificationCursor", NotificationState.prefs(this@TaskNotificationService).getLong("cursor", -1)).toString())
      }
      override fun onMessage(ws: WebSocket, text: String) {
        if (current != generation || stopped) return
        try {
          val m = JSONObject(text)
          when (m.optString("type")) {
            "host" -> {
              retries = 0
              if (!NotificationState.prefs(this@TaskNotificationService).contains("cursor") && m.has("notificationCursor")) NotificationState.prefs(this@TaskNotificationService).edit().putLong("cursor", m.getLong("notificationCursor")).commit()
              connection(m.optBoolean("online"), if (m.optBoolean("online")) "正在接收电脑任务状态" else "电脑离线，正在等待恢复")
            }
            "completion" -> complete(m)
          }
        } catch (_: Exception) { connection(false, "任务通知异常，正在重新连接"); ws.close(1002, "INVALID_EVENT") }
      }
      override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
        Diagnostics.write(this@TaskNotificationService, "notification.socket-error", JSONObject().put("errorCode", t.javaClass.simpleName), "WARN", "notifications"); retry(current)
      }
      override fun onClosing(ws: WebSocket, code: Int, reason: String) { ws.close(code, reason) }
      override fun onClosed(ws: WebSocket, code: Int, reason: String) {
        Diagnostics.write(this@TaskNotificationService, "notification.closed", JSONObject().put("closeCode", code), role = "notifications")
        if (code == 4003) { NotificationState.prefs(this@TaskNotificationService).edit().putBoolean("enabled", false).remove("credentials").commit(); handler.post { stopSelf() } }
        else retry(current)
      }
    })
  }
  private fun retry(current: Int) {
    handler.post {
      if (current != generation || stopped) return@post
      generation++; socket = null; connection(false, "网络中断，正在重新连接")
      val delay = minOf(30000L, 1500L * (1L shl minOf(retries++, 4)))
      handler.postDelayed({ if (!stopped) connect() }, delay)
    }
  }
  private fun complete(m: JSONObject) {
    val p = NotificationState.prefs(this); val cursor = m.getLong("cursor")
    if (cursor <= p.getLong("cursor", -1)) return
    if (!NotificationState.permitted(this)) return
    val id = m.getString("threadId"); require(Regex("[a-zA-Z0-9_-]{1,100}").matches(id))
    val event = m.getString("eventId")
    Diagnostics.write(this, "notification.completion", JSONObject().put("threadId", id).put("id", event).put("cursor", cursor).put("foreground", NotificationState.visible), role = "notifications")
    if (!NotificationState.visible) {
      val intent = Intent(this, MainActivity::class.java).setData(Uri.parse("codexremote://chat/" + Uri.encode(id))).putExtra("notificationThread", id).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      val open = PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      val title = if (m.optString("status") == "failed") "任务执行失败" else "任务已完成"
      val notification = NotificationCompat.Builder(this, "task_results").setSmallIcon(R.drawable.ic_notification).setContentTitle(title).setContentText(m.optString("title", "点击查看聊天")).setStyle(NotificationCompat.BigTextStyle().bigText(m.optString("title"))).setContentIntent(open).setAutoCancel(true).setOnlyAlertOnce(true).setCategory(NotificationCompat.CATEGORY_MESSAGE).setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setPriority(NotificationCompat.PRIORITY_HIGH).build()
      NotificationManagerCompat.from(this).notify(event, 4200, notification)
    }
    check(p.edit().putLong("cursor", cursor).commit())
  }
  override fun onDestroy() {
    Diagnostics.write(this, "notification.service-stop", role = "notifications")
    stopped = true; generation++; handler.removeCallbacksAndMessages(null); socket?.cancel(); socket = null
    http.dispatcher.executorService.shutdown(); http.connectionPool.evictAll()
    NotificationState.connected = false; NotificationState.running = false
    super.onDestroy()
  }
}
