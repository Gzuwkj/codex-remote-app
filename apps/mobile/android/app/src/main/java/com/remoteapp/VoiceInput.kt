package com.remoteapp

import android.Manifest
import android.content.pm.PackageManager
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.common.LifecycleState
import com.facebook.react.uimanager.ViewManager
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.Executors

class VoiceInputPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(VoiceInputModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}

class VoiceInputModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context), LifecycleEventListener {
  private data class Recording(val recorder: MediaRecorder, val file: File, val id: String, val result: Promise)
  private val main = Handler(Looper.getMainLooper())
  private val io = Executors.newSingleThreadExecutor()
  private var recording: Recording? = null
  private val limit = Runnable { finish(true) }
  init { context.addLifecycleEventListener(this) }
  override fun getName() = "VoiceInput"

  @ReactMethod fun start(result: Promise) { main.post {
    if (recording != null) { result.reject("VOICE_BUSY", "录音正在进行"); return@post }
    if (context.lifecycleState != LifecycleState.RESUMED) { result.resolve(null); return@post }
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      result.reject("VOICE_PERMISSION", "请在系统设置中允许麦克风权限"); return@post
    }
    val id = UUID.randomUUID().toString()
    val file = File(File(context.cacheDir, "phone-attachments").apply { mkdirs() }, id)
    var recorder: MediaRecorder? = null
    try {
      val mic = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(context) else MediaRecorder()
      recorder = mic
      mic.setAudioSource(MediaRecorder.AudioSource.MIC)
      mic.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
      mic.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
      mic.setAudioChannels(1)
      mic.setAudioSamplingRate(16000)
      mic.setAudioEncodingBitRate(48000)
      mic.setOutputFile(file.absolutePath)
      mic.prepare()
      mic.start()
      recording = Recording(mic, file, id, result)
      mic.setOnErrorListener { _, _, _ -> finish(false, "麦克风录制中断，请重试") }
      main.postDelayed(limit, 60000)
    } catch (_: Exception) {
      recorder?.release()
      file.delete()
      result.reject("VOICE_START_FAILED", "无法开始录音，请检查麦克风")
    }
  } }

  @ReactMethod fun stop() { main.post { finish(true) } }
  @ReactMethod fun cancel() { main.post { finish(false) } }

  private fun finish(keep: Boolean, failure: String? = null) {
    val current = recording ?: return
    recording = null
    main.removeCallbacks(limit)
    var saved = false
    try { current.recorder.stop(); saved = keep } catch (_: RuntimeException) { }
    finally { current.recorder.release() }
    if (!saved) {
      current.file.delete()
      when {
        failure != null -> current.result.reject("VOICE_RECORD_FAILED", failure)
        keep -> current.result.reject("VOICE_TOO_SHORT", "录音太短，请再试一次")
        else -> current.result.resolve(null)
      }
      return
    }
    io.execute {
      try {
        val bytes = current.file.readBytes()
        require(bytes.isNotEmpty() && bytes.size < 2 * 1024 * 1024)
        val hash = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 255) }
        current.result.resolve(Arguments.createMap().apply {
          putString("id", current.id)
          putString("name", "录音-${current.id.take(8)}.m4a")
          putString("mime", "audio/mp4")
          putDouble("size", bytes.size.toDouble())
          putString("sha256", hash)
          putString("uri", Uri.fromFile(current.file).toString())
        })
      } catch (_: Exception) {
        current.file.delete()
        current.result.reject("VOICE_SAVE_FAILED", "无法保存录音，请重试")
      }
    }
  }
  override fun onHostResume() = Unit
  override fun onHostPause() = cancel()
  override fun onHostDestroy() = cancel()
  override fun invalidate() { context.removeLifecycleEventListener(this); cancel(); super.invalidate() }
}
