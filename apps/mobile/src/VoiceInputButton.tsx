import React, {useEffect, useRef, useState} from 'react';
import {NativeModules, PermissionsAndroid, Platform, Text, View} from 'react-native';
import type {PhoneAttachment} from './attachments';
import {IconButton, type Colors, ui} from './ui';

export function VoiceInputButton({colors, onResult, onError}: {
  colors: Colors;
  onResult: (file: PhoneAttachment) => void;
  onError: (message: string) => void;
}) {
  const voice=NativeModules.VoiceInput;
  const [phase,setPhase]=useState<'idle'|'starting'|'listening'|'processing'>('idle');
  const session=useRef(0), busy=useRef(false);
  useEffect(()=>()=>{session.current++;voice?.cancel()},[voice]);
  if(Platform.OS!=='android'||!voice)return null;
  const cancel=()=>{session.current++;busy.current=false;voice.cancel();setPhase('idle')};
  const start=async()=>{
    if(busy.current)return;
    busy.current=true;const id=++session.current;setPhase('starting');
    try {
      if(session.current!==id)return;
      const permission=await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      if(session.current!==id)return;
      if(permission!==PermissionsAndroid.RESULTS.GRANTED)
        throw Error(permission===PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN?'麦克风权限已关闭，请在系统设置中允许':'未允许麦克风权限，仍可使用键盘输入');
      setPhase('listening');
      const file=await voice.start();
      if(session.current===id&&file)onResult(file);
    } catch(error:any) {
      if(session.current===id&&error?.code!=='VOICE_CANCELLED')onError(error?.message??'录音失败，请重试');
    } finally {
      if(session.current===id){busy.current=false;setPhase('idle')}
    }
  };
  return <View style={ui.row}>
    {phase==='listening'&&<Text accessibilityLiveRegion="polite" style={{color:colors.muted,fontSize:12}}>正在录音…</Text>}
    {phase==='processing'&&<Text accessibilityLiveRegion="polite" style={{color:colors.muted,fontSize:12}}>保存录音…</Text>}
    <IconButton name={phase==='listening'?'stop':'mic'} colors={colors}
      label={phase==='listening'?'结束录音':'录音附件'} disabled={phase==='starting'||phase==='processing'}
      onPress={phase==='listening'?()=>{setPhase('processing');voice.stop()}:start}/>
    {(phase==='listening'||phase==='processing')&&<IconButton name="close" colors={colors} label="取消录音" onPress={cancel}/>}
  </View>;
}
