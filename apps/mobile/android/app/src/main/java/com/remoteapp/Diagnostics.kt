package com.remoteapp

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Environment
import android.os.SystemClock
import android.provider.MediaStore
import android.util.Log
import androidx.core.content.FileProvider
import com.facebook.react.bridge.*
import org.json.JSONObject
import java.io.File

internal object Diagnostics {
  private val allowed = "connectionId role device id commandId method threadId runtimeId epoch seq revision baseRevision bytes elapsedMs latencyMs bufferedBytes closeCode errorCode attempt online foreground reason url activeTurnId status cursor duplicate stage port version pid kind lastReceivedAt count phase".split(" ").toSet()
  private fun dir(c: Context) = File(c.filesDir, "diagnostics").apply { mkdirs() }
  @Synchronized fun write(c: Context, event: String, details: JSONObject = JSONObject(), level: String = "INFO", role: String = "app") {
    try {
      val record = JSONObject().put("atMs", System.currentTimeMillis()).put("uptimeMs", SystemClock.elapsedRealtime()).put("role", role).put("version", BuildConfig.VERSION_NAME).put("level", level).put("event", event.take(100))
      for (key in details.keys()) if (key in allowed) {
        val value = details.get(key)
        if (value is String) record.put(key, (if (key == "url") value.substringBefore('?').substringBefore('#').replace(Regex("//[^/@]+@"), "//[redacted]@") else value).take(300))
        else if (value is Number || value is Boolean) record.put(key, value)
      }
      val line = record.toString(); val file = File(dir(c), "app.log")
      if (file.length() + line.toByteArray(Charsets.UTF_8).size > 1024 * 1024) {
        val two = File(dir(c), "app.log.2"); if (two.exists()) two.delete()
        val one = File(dir(c), "app.log.1"); if (one.exists()) one.renameTo(two)
        file.renameTo(one)
      }
      file.appendText(line + "\n", Charsets.UTF_8)
      Log.i("RemoteDiagnostics", line)
    } catch (_: Exception) { /* Diagnostics must not interrupt normal work. */ }
  }
  @Synchronized fun read(c: Context, tail: Boolean = true): String {
    val content = listOf("app.log.2", "app.log.1", "app.log").map { File(dir(c), it) }.filter { it.exists() }.joinToString("") { it.readText(Charsets.UTF_8) }
    return if (tail) content.takeLast(128 * 1024) else content
  }
}
class DiagnosticsModule(private val c: ReactApplicationContext) : ReactContextBaseJavaModule(c) {
  override fun getName() = "Diagnostics"
  @ReactMethod fun append(event: String, details: String, level: String) { Diagnostics.write(c, event, JSONObject(details), level) }
  @ReactMethod fun read(promise: Promise) {
    try { promise.resolve(Diagnostics.read(c)) } catch (e: Exception) { promise.reject("LOG_READ_FAILED", "无法读取日志", e) }
  }
  @ReactMethod fun exportLog(promise: Promise) {
    try {
      val name = "codex-remote-" + BuildConfig.VERSION_NAME + "-" + System.currentTimeMillis() + ".log"
      val content = "Codex Remote diagnostics; Android API " + Build.VERSION.SDK_INT + "\n" + Diagnostics.read(c, false)
      if (Build.VERSION.SDK_INT >= 29) {
        val values = ContentValues().apply {
          put(MediaStore.Downloads.DISPLAY_NAME, name); put(MediaStore.Downloads.MIME_TYPE, "text/plain")
          put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/CodexRemote"); put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val uri = c.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: error("LOG_EXPORT_FAILED")
        try {
          c.contentResolver.openOutputStream(uri)!!.use { it.write(content.toByteArray(Charsets.UTF_8)) }
          c.contentResolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
        } catch (e: Exception) { c.contentResolver.delete(uri, null, null); throw e }
        promise.resolve(uri.toString())
      } else {
        val file = File(File(c.cacheDir, "diagnostic-exports").apply { mkdirs() }, name).apply { writeText(content, Charsets.UTF_8) }
        val uri = FileProvider.getUriForFile(c, c.packageName + ".artifacts", file)
        val share = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        c.startActivity(Intent.createChooser(share, "导出诊断日志").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); promise.resolve(uri.toString())
      }
      Diagnostics.write(c, "logs.exported")
    } catch (e: Exception) { promise.reject("LOG_EXPORT_FAILED", "日志导出失败，请重试", e) }
  }
}
