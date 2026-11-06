package com.remoteapp

import android.content.Context
import org.json.JSONObject
import org.json.JSONArray
import java.io.File

/** Native-only cache: never depends on JS timers or UI rendering. Access on one IO executor. */
internal class BackgroundThreadStore(private val context: Context) {
  private var current: JSONObject? = null
  private var runtime = ""
  private var lastWrite = 0L
  private fun file(id: String): File {
    require(Regex("[a-zA-Z0-9_-]{1,100}").matches(id))
    return File(File(context.filesDir, "background-threads").apply { mkdirs() }, "$id.json")
  }
  fun apply(frame: JSONObject, deviceId: String, selected: String) {
    val epoch=frame.getString("epoch")
    val previous=current
    val next=if(frame.optString("method")=="thread.snapshot") frame.getJSONObject("thread") else {
      val update=frame.getJSONObject("update")
      require(runtime==epoch && previous!=null && previous.getString("id")==update.getString("threadId") && previous.getLong("revision")==update.getLong("baseRevision")) { "BACKGROUND_REVISION_GAP" }
      val existing=previous!!.getJSONArray("items"); val items=LinkedHashMap<String,JSONObject>()
      for(i in 0 until existing.length()) { val item=existing.getJSONObject(i);items[item.getString("id")]=item }
      val upserts=update.getJSONArray("upserts")
      for(i in 0 until upserts.length()) { val item=upserts.getJSONObject(i);items[item.getString("id")]=item }
      val order=update.optJSONArray("order"); val result=JSONArray()
      if(order!=null) for(i in 0 until order.length()) result.put(requireNotNull(items[order.getString(i)]))
      else for(i in 0 until existing.length()) result.put(items[existing.getJSONObject(i).getString("id")])
      JSONObject(update.getJSONObject("meta").toString()).put("id",update.getString("threadId")).put("revision",update.getLong("revision")).put("items",result)
    }
    if(next.getString("id")!=selected)return
    if(runtime==epoch && previous?.optString("id")==selected && previous.optLong("revision")>next.optLong("revision"))return
    val changedRuntime=runtime!=epoch
    current=next;runtime=epoch
    val urgent=previous==null || previous.optString("id")!=selected || changedRuntime || next.optString("activeTurnId").isBlank() || previous.optString("activeTurnId")!=next.optString("activeTurnId")
    if(!urgent && System.currentTimeMillis()-lastWrite<1000)return
    val destination=file(selected);val temp=File(destination.parentFile,destination.name+".tmp")
    temp.writeText(JSONObject().put("epoch",epoch).put("deviceId",deviceId).put("receivedAt",System.currentTimeMillis()).put("thread",next).toString())
    check(temp.renameTo(destination));lastWrite=System.currentTimeMillis()
    Diagnostics.write(context,"background.snapshot-saved",JSONObject().put("threadId",selected).put("epoch",epoch).put("revision",next.optLong("revision")).put("foreground",NotificationState.visible),role="notifications")
  }
  fun read(id: String, deviceId: String): String? {
    val f=file(id);if(!f.exists())return null
    val text=f.readText();return if(JSONObject(text).optString("deviceId")==deviceId)text else null
  }
}
