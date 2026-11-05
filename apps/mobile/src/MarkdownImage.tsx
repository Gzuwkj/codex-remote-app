import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native';
import { client } from './client';
import type { Colors } from './ui';

export const isDesktopFile = (url: string) => /^\/?[a-z]:[\\/]/i.test(url);
const cache = new Map<string, string>();
export function MarkdownImage({ source, label, threadId, colors: c, onOpen }: {
  source: string; label: string; threadId: string; colors: Colors; onOpen: () => void;
}) {
  const [uri, setUri] = useState(''), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [width, setWidth] = useState(320), [ratio, setRatio] = useState(1.5);
  useEffect(() => {
    let live = true;
    const key = threadId + ':' + source;
    setError(''); setUri('');
    const load = async () => {
      try {
        let value = cache.get(key);
        if (!value) {
          if (isDesktopFile(source)) value = (await client.rpc('artifact/read', { threadId, path: source })).dataUri;
          else if (/^https:\/\//i.test(source)) value = source;
          else throw Error('暂不支持此图片地址');
          if (!value) throw Error('图片数据为空');
          if (cache.size >= 12) cache.delete(cache.keys().next().value!);
          cache.set(key, value);
        }
        if (live) setUri(value);
      } catch (e: any) { if (live) setError(/ENOENT/.test(e.message) ? '电脑上的图片已不存在' : '图片加载失败，请确认电脑在线后重试'); }
    };
    load();
    return () => { live = false; };
  }, [source, threadId, retry]);
  return <View onLayout={e => setWidth(e.nativeEvent.layout.width)} style={{ width: '100%', marginVertical: 10 }}>
    {uri && !error ? <Pressable accessibilityRole="button" accessibilityLabel={'查看图片 ' + label} onPress={onOpen}>
      <Image accessibilityLabel={label || '聊天图片'} source={{ uri }} resizeMode="contain"
        onLoad={e => { const size = e.nativeEvent.source; if (size.width && size.height) setRatio(size.width / size.height); }}
        onError={() => { cache.delete(threadId + ':' + source); setError('图片加载失败，点击重试'); }}
        style={{ width: '100%', height: Math.min(420, Math.max(100, width / ratio)), borderRadius: 12 }} />
    </Pressable> : <Pressable accessibilityRole="button" accessibilityLabel={error ? '重试加载图片' : '正在加载图片'}
      disabled={!error} onPress={() => { setUri(''); setRetry(n => n + 1); }}
      style={{ minHeight: 130, borderRadius: 12, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, alignItems: 'center', justifyContent: 'center', padding: 18 }}>
      {!error && <ActivityIndicator color={c.muted} />}
      <Text style={{ color: c.muted, marginTop: 8, textAlign: 'center' }}>{error || '正在从电脑加载图片…'}</Text>
      {!!error && <Text style={{ color: '#287bde', marginTop: 8 }}>点击重试</Text>}
    </Pressable>}
  </View>;
}
