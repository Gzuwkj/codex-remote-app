package com.remoteapp

import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager
import androidx.core.content.FileProvider
import java.io.File
import java.io.OutputStream
import java.util.UUID

class ArtifactPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(ArtifactModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
class ArtifactModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private data class Transfer(val uri: Uri, val stream: OutputStream, var bytes: Long = 0, val file: File? = null)
  private val transfers = mutableMapOf<String, Transfer>()
  override fun getName() = "RemoteArtifacts"
  private fun snapshot(id: String): File {
    require(Regex("[a-zA-Z0-9_-]{1,100}").matches(id))
    return File(File(context.filesDir, "threads").apply { mkdirs() }, "$id.json")
  }
  @ReactMethod fun readSnapshot(id: String, promise: Promise) {
    try { val file = snapshot(id); promise.resolve(if (file.exists()) file.readText() else null) }
    catch (e: Exception) { promise.reject("CACHE_READ_FAILED", e.message, e) }
  }
  @ReactMethod fun writeSnapshot(id: String, text: String, promise: Promise) {
    try {
      val file = snapshot(id)
      val temp = File(file.parentFile, "${file.name}.tmp")
      temp.writeText(text)
      check(temp.renameTo(file)) { "无法保存聊天缓存" }
      promise.resolve(null)
    } catch (e: Exception) { promise.reject("CACHE_WRITE_FAILED", e.message, e) }
  }
  @ReactMethod fun begin(name: String, mime: String, promise: Promise) {
    try {
      val safeName = name.replace(Regex("[\\\\/:*?\"<>|]"), "_").take(180).ifBlank { "download" }
      val transfer = if (Build.VERSION.SDK_INT >= 29) {
        val values = ContentValues().apply {
          put(MediaStore.MediaColumns.DISPLAY_NAME, safeName)
          put(MediaStore.MediaColumns.MIME_TYPE, mime)
          put(MediaStore.MediaColumns.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/CodexRemote")
          put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val uri = context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: error("无法创建下载文件")
        try { Transfer(uri, context.contentResolver.openOutputStream(uri, "w") ?: error("无法写入文件")) }
        catch (e: Exception) { context.contentResolver.delete(uri, null, null); throw e }
      } else {
        val folder = File(context.filesDir, "downloads").apply { mkdirs() }
        val file = File(folder, "${UUID.randomUUID()}-$safeName")
        Transfer(FileProvider.getUriForFile(context, "${context.packageName}.artifacts", file), file.outputStream(), file = file)
      }
      val id = UUID.randomUUID().toString()
      transfers[id] = transfer
      promise.resolve(id)
    } catch (e: Exception) { promise.reject("DOWNLOAD_FAILED", e.message, e) }
  }
  @ReactMethod fun write(id: String, base64: String, promise: Promise) {
    try {
      val transfer = transfers[id] ?: error("下载已关闭")
      val bytes = Base64.decode(base64, Base64.DEFAULT)
      transfer.stream.write(bytes)
      transfer.bytes += bytes.size
      promise.resolve(transfer.bytes.toDouble())
    } catch (e: Exception) { promise.reject("DOWNLOAD_FAILED", e.message, e) }
  }
  @ReactMethod fun finish(id: String, expectedSize: Double, promise: Promise) {
    try {
      val transfer = transfers[id] ?: error("下载已关闭")
      check(transfer.bytes == expectedSize.toLong()) { "下载不完整" }
      transfer.stream.close()
      if (Build.VERSION.SDK_INT >= 29 && transfer.file == null)
        context.contentResolver.update(transfer.uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
      transfers.remove(id)
      promise.resolve(transfer.uri.toString())
    } catch (e: Exception) { promise.reject("DOWNLOAD_FAILED", e.message, e) }
  }
  @ReactMethod fun abort(id: String, promise: Promise) {
    try {
      transfers.remove(id)?.let { t ->
        try { t.stream.close() } finally {
          if (t.file != null) t.file.delete() else context.contentResolver.delete(t.uri, null, null)
        }
      }
      promise.resolve(null)
    } catch (e: Exception) { promise.reject("DOWNLOAD_FAILED", e.message, e) }
  }
  @ReactMethod fun open(uri: String, mime: String, promise: Promise) {
    try {
      val intent = Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse(uri), mime)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
      context.startActivity(intent)
      promise.resolve(null)
    } catch (e: Exception) { promise.reject("OPEN_FAILED", "文件已保存，当前设备没有可打开此文件的应用", e) }
  }
}
