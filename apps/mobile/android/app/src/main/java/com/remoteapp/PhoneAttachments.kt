package com.remoteapp

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import com.facebook.react.bridge.*
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.Executors

class PhoneAttachmentsModule(private val c: ReactApplicationContext) : ReactContextBaseJavaModule(c) {
  private var pending: Promise? = null
  private val io = Executors.newSingleThreadExecutor()
  private fun file(id: String): File {
    require(Regex("[a-fA-F0-9-]{36}").matches(id))
    return File(File(c.cacheDir, "phone-attachments").apply { mkdirs() }, id)
  }
  init {
    c.addActivityEventListener(object : BaseActivityEventListener() {
      override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != 7412) return
        val promise = pending ?: return; pending = null
        if (resultCode != Activity.RESULT_OK) { promise.resolve(Arguments.createArray()); return }
        val uris = if (data?.clipData != null) (0 until data.clipData!!.itemCount).map { data.clipData!!.getItemAt(it).uri } else listOfNotNull(data?.data)
        io.execute {
          val created = mutableListOf<File>()
          try {
            require(uris.size <= 5) { "一次最多选择 5 个附件" }
            val output = Arguments.createArray()
            for (uri in uris) {
              val mime = c.contentResolver.getType(uri) ?: "application/octet-stream"
              require(!mime.startsWith("image/") || mime in listOf("image/png", "image/jpeg", "image/webp")) { "图片目前支持 PNG、JPEG 和 WebP 格式" }
              var name = "attachment"
              c.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) { name = cursor.getString(0) ?: name; if (!cursor.isNull(1)) require(cursor.getLong(1) <= 20 * 1024 * 1024) { "单个附件不能超过 20MB" } }
              }
              val id = UUID.randomUUID().toString(); val dest = file(id); created.add(dest)
              val digest = MessageDigest.getInstance("SHA-256"); var size = 0L
              c.contentResolver.openInputStream(uri)!!.use { input -> dest.outputStream().use { out ->
                val buffer = ByteArray(64 * 1024)
                while (true) { val count = input.read(buffer); if (count < 0) break; size += count; require(size <= 20 * 1024 * 1024) { "单个附件不能超过 20MB" }; digest.update(buffer, 0, count); out.write(buffer, 0, count) }
              } }
              require(size > 0) { "不能添加空文件" }
              output.pushMap(Arguments.createMap().apply {
                putString("id", id); putString("name", name.take(180)); putString("mime", mime); putDouble("size", size.toDouble())
                putString("sha256", digest.digest().joinToString("") { "%02x".format(it.toInt() and 255) }); putString("uri", Uri.fromFile(dest).toString())
              })
              Diagnostics.write(c, "attachment.selected", JSONObject().put("id", id).put("bytes", size).put("kind", if (mime.startsWith("image/")) "image" else "file"))
            }
            promise.resolve(output)
          } catch (e: Exception) { created.forEach { it.delete() }; promise.reject("ATTACHMENT_PICK_FAILED", e.message ?: "无法读取附件，请重选", e) }
        }
      }
    })
  }
  override fun getName() = "PhoneAttachments"
  @ReactMethod fun pick(images: Boolean, promise: Promise) {
    val activity = c.currentActivity
    if (activity == null || pending != null) { promise.reject("PICKER_UNAVAILABLE", "请回到 App 后重试"); return }
    pending = promise
    try {
      activity.startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).setType(if (images) "image/*" else "*/*").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), 7412)
    } catch (e: Exception) { pending = null; promise.reject("PICKER_UNAVAILABLE", "无法打开系统文件选择器", e) }
  }
  @ReactMethod fun chunk(id: String, offset: Double, promise: Promise) {
    io.execute {
      try {
        val source = file(id); require(source.exists()) { "手机附件缓存已不存在，请重新选择" }
        require(offset >= 0 && offset <= source.length() && offset == offset.toLong().toDouble())
        val bytes = RandomAccessFile(source, "r").use { it.seek(offset.toLong()); val b = ByteArray(minOf(256L * 1024, source.length() - offset.toLong()).toInt()); it.readFully(b); b }
        promise.resolve(Arguments.createMap().apply { putString("base64", Base64.encodeToString(bytes, Base64.NO_WRAP)); putDouble("next", offset + bytes.size) })
      } catch (e: Exception) { promise.reject("ATTACHMENT_READ_FAILED", e.message ?: "读取附件失败", e) }
    }
  }
}
