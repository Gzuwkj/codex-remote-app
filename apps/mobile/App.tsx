import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  BackHandler,
  FlatList,
  Image,
  Linking,
  NativeModules,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Clipboard from '@react-native-clipboard/clipboard';
import Markdown from 'react-native-markdown-display';
import { client, type Thread } from './src/client';
import {enableNotifications, disableNotifications, restoreNotifications, notificationStatus, type NotificationStatus} from './src/notifications';
import {readDiagnostics,exportDiagnostics} from './src/diagnostics';
import {pickAttachments,uploadAttachments,type PhoneAttachment} from './src/attachments';
import { VoiceInputButton } from './src/VoiceInputButton';
import { RequestCard } from './src/RequestCard';
import { MarkdownImage, isDesktopFile } from './src/MarkdownImage';
import {
  Icon,
  IconButton,
  Pill,
  palette,
  ui,
  type Colors,
  type IconName,
} from './src/ui';
import {
  displayRows,
  normalizePath,
  pathName,
  shortTitle,
  workLabel,
  type DisplayRow,
} from './src/presentation';
type Outbox = { id: string; threadId: string; text: string; status: string; attachments?:PhoneAttachment[] };
const readThreadCache = async (id: string): Promise<string | null> => {
  const saved = await NativeModules.RemoteArtifacts?.readSnapshot(id);
  if (saved) return saved;
  try { return await AsyncStorage.getItem('thread:' + id); }
  catch { await AsyncStorage.removeItem('thread:' + id); return null; }
};
type Sheet =
  | 'projects'
  | 'connection'
  | 'actions'
  | 'queue'
  | 'message'
  | 'requests'
  | 'diagnostics'
  | null;
const errorText = (e: any) => {
  const v = e?.message ?? String(e);
  if (/no-client-found/.test(v))
    return '电脑未能加载这段聊天，请重试。';
  if (/DESKTOP_THREAD_LOAD|DESKTOP_TOOL|DESKTOP_APP_TOOLS/.test(v))
    return '电脑未能自动加载这段聊天，请重试或检查 Bridge 日志。';
  if (/TIMEOUT|超时/.test(v))
    return '电脑暂时没有响应。请先刷新聊天确认结果，避免重复发送。';
  return v;
};
export default function App() {
  return (
    <SafeAreaProvider>
      <RemoteScreen />
    </SafeAreaProvider>
  );
}
function RemoteScreen() {
  const dark = useColorScheme() === 'dark',
    c = palette(dark),
    insets = useSafeAreaInsets(),
    { width } = useWindowDimensions();
  const [booting, setBooting] = useState(true),
    [paired, setPaired] = useState(false),
    [online, setOnline] = useState(false),
    [connecting, setConnecting] = useState(false);
  const [url, setUrl] = useState(client.url),
    [code, setCode] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [notifications, setNotifications] = useState<NotificationStatus>({enabled:false,permitted:false,connected:false,running:false});
  const [connectionMessage,setConnectionMessage]=useState('正在连接中转');
  const openChatRef = useRef<(id:string)=>Promise<void>>(async()=>{});
  const notificationBusy = useRef(false);
  const [diagnosticLog,setDiagnosticLog]=useState('');
  const [attachments,setAttachments]=useState<PhoneAttachment[]>([]);
  const [attachmentProgress,setAttachmentProgress]=useState<Record<string,number>>({});
  const attachmentRef=useRef<PhoneAttachment[]>([]),attachmentScope=useRef('');
  const saveAttachments=(files:PhoneAttachment[])=>{
    attachmentRef.current=files;setAttachments(files);
    if(attachmentScope.current)AsyncStorage.setItem('attachments:'+attachmentScope.current,JSON.stringify(files));
  };
  const clearSentAttachments=async(scope:string,sent:PhoneAttachment[])=>{
    const ids=new Set(sent.map(f=>f.id));
    const saved=JSON.parse(await AsyncStorage.getItem('attachments:'+scope)??'[]').filter((f:PhoneAttachment)=>!ids.has(f.id));
    await AsyncStorage.setItem('attachments:'+scope,JSON.stringify(saved));
    if(attachmentScope.current===scope){attachmentRef.current=saved;setAttachments(saved);}
    setAttachmentProgress({});
  };
  const selectPhoneAttachments=async(images:boolean)=>{
    setSheet(null);Keyboard.dismiss();
    const scope=attachmentScope.current;
    try{
      const files=await pickAttachments(images);
      if(attachmentScope.current!==scope)return;
      if(attachmentRef.current.length+files.length>5){toast('每条消息最多添加 5 个附件');return;}
      saveAttachments([...attachmentRef.current,...files]);
    }catch(e){toast(errorText(e));}
  };
  const [catalog, setCatalog] = useState<any[]>([]),
    [projects, setProjects] = useState<any[]>([]),
    [project, setProject] = useState<string | null>(null),
    [titles, setTitles] = useState<Record<string, string>>({});
  const [screen, setScreen] = useState<'home' | 'chat' | 'new'>('home'),
    [thread, setThread] = useState<Thread | null>(null),
    [draft, setDraft] = useState(''),
    [newPrompt, setNewPrompt] = useState('');
  useEffect(()=>{
    const scope=screen==='chat'?client.selected??'':screen==='new'?'new:'+(project??''):'';
    if(attachmentScope.current===scope)return;
    attachmentScope.current=scope;attachmentRef.current=[];setAttachments([]);
    if(scope)AsyncStorage.getItem('attachments:'+scope).then(value=>{
      if(attachmentScope.current===scope){const files=JSON.parse(value??'[]');attachmentRef.current=files;setAttachments(files);}
    }).catch(()=>{});
  },[screen,thread?.id,project]);
  const [sending, setSending] = useState(false),
    [stopping, setStopping] = useState(false),
    [refreshing, setRefreshing] = useState(false),
    [opening, setOpening] = useState(false);
  const [drawer, setDrawer] = useState(false),
    [sheet, setSheet] = useState<Sheet>(null),
    [search, setSearch] = useState(''),
    [detail, setDetail] = useState<any>(null),
    [message, setMessage] = useState<any>(null),
    [jump, setJump] = useState(false),
    [queue, setQueue] = useState<Outbox[]>([]);
  const queueRef = useRef<Outbox[]>([]),
    downloadCancel = useRef(false),
    draftRef = useRef(''),
    sendingRef = useRef(false),
    follow = useRef(true),
    dragging = useRef(false),
    wasActive = useRef(false);
  const list = useRef<FlatList>(null),
    toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    refreshRef = useRef<() => Promise<void>>(async () => {}),
    drawerX = useRef(new Animated.Value(-360)).current;
  const toast = (text: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setNotice(text);
    toastTimer.current = setTimeout(() => setNotice(''), 2600);
  };
  const copy = (text: string) => {
    Clipboard.setString(text);
    toast('已复制');
  };
  const persistQueue = async (next: Outbox[]) => {
    queueRef.current = next;
    setQueue(next);
    await AsyncStorage.setItem('outbox', JSON.stringify(next));
  };
  const acceptThread = (next: Thread) => {
    if (client.selected !== next.id) return;
    setThread(next);
    setTitles(previous => ({ ...previous, [next.id]: next.title }));
  };
  const refreshAttempt = useRef(0);
  const refresh = async () => {
    if (!client.online) return;
    const attempt = ++refreshAttempt.current;
    const socket = client.ws;
    const epoch = client.epoch;
    const current = () => attempt === refreshAttempt.current && socket === client.ws && epoch === client.epoch;
    setRefreshing(true);
    setError('');
    const id = client.selected;
    try {
      await Promise.allSettled([
        client
          .rpc('thread/list')
          .then(async rows => {
            if (!current()) return;
            setCatalog(rows);
            await AsyncStorage.setItem('desktop-catalog-v1', JSON.stringify(rows));
          })
          .catch(() => { if (current()) setError('会话列表同步失败，已保留现有列表，可下拉重试。'); }),
        client
          .rpc('project/list')
          .then(value => { if (current()) setProjects(value.projects ?? []); })
          .catch(() => {}),
        id
          ? client
              .rpc('thread/read', { threadId: id })
              .then(value => { if (current()) acceptThread(value); })
              .catch(e => { if (current() && client.selected === id) setError(errorText(e)); })
          : Promise.resolve(),
      ]);
    } finally {
      if (attempt === refreshAttempt.current) setRefreshing(false);
    }
  };
  refreshRef.current = refresh;
  useEffect(() => {
    if(sheet !== 'connection') return;
    let cancelled=false;
    const update=()=>notificationStatus().then(value=>{if(!cancelled)setNotifications(value)}).catch(()=>{});
    update();const timer=setInterval(update,2000);
    return ()=>{cancelled=true;clearInterval(timer)};
  },[sheet]);
  const refreshNotifications = async (prompt = false) => {
    if(notificationBusy.current)return;
    notificationBusy.current=true;
    try {
      let status=await restoreNotifications();
      if(prompt && !(await AsyncStorage.getItem('notification-prompted'))) {
        await AsyncStorage.setItem('notification-prompted','1');
        status=await enableNotifications();
      }
      setNotifications(status);
    } catch(e) { setNotifications(await notificationStatus()); toast(errorText(e)); }
    finally {notificationBusy.current=false;}
  };
  const openFromNotification = async () => {
    const id=await NativeModules.TaskNotifications.consumeOpenThread();
    if(id) await openChatRef.current(id);
  };
  useEffect(()=>{
    if(!booting && paired) {refreshNotifications(true);openFromNotification();}
  },[booting,paired]);
  useEffect(() => {
    const listener = (m: any) => {
      if (m.type === 'restored') setPaired(true);
      if (m.type === 'connected') {
        setPaired(true);
        setOnline(true);
        setConnecting(false);
        setError('');
        refreshRef.current();
      }
      if (m.type === 'offline') {
        setOnline(false);
        setConnectionMessage(m.reason==='host'?'电脑离线':m.reason==='reconnecting'?'正在连接中转':'网络中断，正在重连');
      }
      if (m.type === 'pair.pending') {
        setConnecting(true);
        toast('请在电脑上确认连接');
      }
      if (m.type === 'error') {
        setConnecting(false);
        setError(errorText(m.error));
      }
      if(m.type==='event'&&m.method==='catalog.status'){
        if(m.statuses.every((t:any)=>typeof t.cwd==='string'&&typeof t.title==='string')) {
          setCatalog(m.statuses);
          AsyncStorage.setItem('desktop-catalog-v1',JSON.stringify(m.statuses)).catch(()=>{});
        } else {
          const states=new Map(m.statuses.map((t:any)=>[t.id,t]));
          setCatalog(previous=>previous.map(row=>({...row,...(states.get(row.id) as object??{})})));
        }
      }
      if (
        m.type === 'event' &&
        m.method === 'thread.snapshot' &&
        m.thread.id === client.selected
      ) {
        acceptThread(m.thread);
        if (wasActive.current && !m.thread.activeTurnId)
          toast(
            m.thread.lastTurnStatus === 'interrupted'
              ? '任务已停止'
              : m.thread.lastTurnStatus === 'failed'
              ? '任务失败，请查看工作过程'
              : '任务已完成',
          );
        wasActive.current = !!m.thread.activeTurnId;
      }
    };
    client.listeners.add(listener);
    (async () => {
      try {
        const rows = await AsyncStorage.getItem('desktop-catalog-v1');
        if (rows) setCatalog(JSON.parse(rows));
        const box = await AsyncStorage.getItem('outbox');
        if (box) {
          const rows = JSON.parse(box).map((q: Outbox) =>
            q.status === '正在发送' ? { ...q, status: '结果待确认' } : q,
          );
          queueRef.current = rows;
          setQueue(rows);
        }
        const id = await AsyncStorage.getItem('last-thread');
        if (id) {
          const cached = await readThreadCache(id);
          if (cached) {
            client.select(id);
            const value = JSON.parse(cached);
            setThread(value);
            setTitles({ [id]: value.title });
            setScreen('chat');
            const text = (await AsyncStorage.getItem('draft:' + id)) ?? '';
            draftRef.current = text;
            setDraft(text);
          }
        }
      } catch (e) {
        setError(errorText(e));
      } finally {
        try { await client.restore(); setUrl(client.url); }
        catch (e) { setError(errorText(e)); }
        setBooting(false);
      }
    })();
    const sub = AppState.addEventListener('change', state => {
      client.setForeground(state === 'active');
      if (state === 'active' && client.credentials) {
        refreshNotifications();
        openFromNotification();
        const resumed=client.resume();
        client.restoreBackground().catch(()=>{});
        resumed.then(alive=>{if(alive)refreshRef.current()});
      }
    });
    return () => {
      client.listeners.delete(listener);
      sub.remove();
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);
  useEffect(() => {
    if (!thread || screen !== 'chat') return;
    const timer = setTimeout(() => {
      const snapshot = JSON.stringify(thread);
      if (NativeModules.RemoteArtifacts?.writeSnapshot)
        NativeModules.RemoteArtifacts.writeSnapshot(thread.id, snapshot).catch(() => toast('聊天缓存未能保存，草稿不受影响'));
      else if (snapshot.length < 400000)
        AsyncStorage.setItem('thread:' + thread.id, snapshot).catch(() => {});
      AsyncStorage.setItem('last-thread', thread.id);
    }, 450);
    return () => clearTimeout(timer);
  }, [thread, screen]);
  useEffect(() => {
    if (drawer) {
      drawerX.setValue(-Math.min(width * 0.88, 360));
      Animated.timing(drawerX, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start();
    }
  }, [drawer, width]);
  const closeDrawer = () => {
    Keyboard.dismiss();
    Animated.timing(drawerX, {
      toValue: -Math.min(width * 0.88, 360),
      duration: 180,
      useNativeDriver: true,
    }).start(() => setDrawer(false));
  };
  const goHome = () => {
    Keyboard.dismiss();
    client.select(undefined);
    setThread(null);
    setScreen('home');
    setError('');
    AsyncStorage.removeItem('last-thread');
  };
  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (detail) {
        setDetail(null);
        return true;
      }
      if (sheet) {
        setSheet(null);
        return true;
      }
      if (drawer) {
        closeDrawer();
        return true;
      }
      if (screen !== 'home') {
        goHome();
        return true;
      }
      return false;
    });
    return () => back.remove();
  }, [detail, sheet, drawer, screen]);
  const updateDraft = (text: string) => {
    draftRef.current = text;
    setDraft(text);
    if (client.selected) AsyncStorage.setItem('draft:' + client.selected, text);
  };
  const openChat = async (id: string) => {
    Keyboard.dismiss();
    if (drawer) closeDrawer();
    setSheet(null);
    setError('');
    setScreen('chat');
    setOpening(true);
    setThread(null);
    setJump(false);
    follow.current = true;
    wasActive.current = false;
    client.select(id);
    try {
      const [cached, text] = await Promise.all([
        readThreadCache(id),
        AsyncStorage.getItem('draft:' + id),
      ]);
      if (client.selected !== id) return;
      draftRef.current = text ?? '';
      setDraft(text ?? '');
      if (cached) acceptThread(JSON.parse(cached));
      await AsyncStorage.setItem('last-thread', id);
      if (client.online)
        acceptThread(await client.rpc('thread/read', { threadId: id }));
      else if (!cached) throw Error('电脑离线，暂时无法打开这段聊天。');
    } catch (e) {
      setError(errorText(e));
    } finally {
      if (client.selected === id) setOpening(false);
    }
  };
  const registered = projects.filter(p => p.projectKind === 'local'),
    selectedProject = registered.find(
      p => project && normalizePath(p.path) === normalizePath(project),
    );
  const projectLabel = project
    ? projects.find(p => normalizePath(p.path ?? '') === normalizePath(project))
        ?.label ?? pathName(project)
    : '所有项目';
  openChatRef.current = openChat;
  const beginNew = () => {
    Keyboard.dismiss();
    if (drawer) closeDrawer();
    setSheet(null);
    client.select(undefined);
    setThread(null);
    setError('');
    setScreen('new');
    setNewPrompt('');
    if (!selectedProject && registered.length) setProject(registered[0].path);
  };
  const create = async () => {
    const selectedFiles=[...attachmentRef.current],scope=attachmentScope.current;
    const text = newPrompt.trim()||(selectedFiles.length?'请查看附件。':'');
    if (!text || sendingRef.current) return;
    if (!selectedProject) {
      setSheet('projects');
      return;
    }
    sendingRef.current = true;
    setSending(true);
    setError('');
    Keyboard.dismiss();
    try {
      const uploaded=await uploadAttachments(selectedFiles,(id,percent)=>setAttachmentProgress(p=>({...p,[id]:percent})));
      const result = await client.rpc('thread/start', {
        attachments:uploaded,
        projectId: selectedProject.projectId,
        contextThreadId: catalog.find(
          t => normalizePath(t.cwd) === normalizePath(selectedProject.path),
        )?.id,
        text,
        title: shortTitle(text),
      });
      if (!result.threadId) throw Error('聊天正在准备，请稍后在列表刷新查看。');
      setNewPrompt('');
      await clearSentAttachments(scope,selectedFiles);
      await openChat(result.threadId);
      refreshRef.current();
    } catch (e) {
      setError(errorText(e));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };
  const send = async () => {
    const selectedFiles=[...attachmentRef.current],scope=attachmentScope.current;
    const text = draftRef.current.trim()||(selectedFiles.length?'请查看附件。':''),
      id = client.selected;
    if (!text || !id || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError('');
    Keyboard.dismiss();
    follow.current = true;
    const existing = queueRef.current.find(
        q => q.threadId === id && q.text === text && q.status === '待发送' && JSON.stringify(q.attachments?.map(f=>f.id)??[])===JSON.stringify(selectedFiles.map(f=>f.id)),
      ),
      entry: Outbox = existing ?? {
        id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2),
        threadId: id,
        text,
        attachments:selectedFiles,
        status: '待发送',
      };
    try {
      await persistQueue([
        ...queueRef.current.filter(q => q.id !== entry.id),
        entry,
      ]);
      if (!client.online) {
        if (draftRef.current.trim() === text) updateDraft('');
        toast('已保存到待发送记录');
        return;
      }
      await persistQueue(
        queueRef.current.map(q =>
          q.id === entry.id ? { ...q, status: '正在发送' } : q,
        ),
      );
      const uploaded=await uploadAttachments(selectedFiles,(fileId,percent)=>setAttachmentProgress(p=>({...p,[fileId]:percent})));
      await client.rpc(thread?.activeTurnId ? 'turn/steer' : 'turn/start', {
        attachments:uploaded,
        threadId: id,
        text,
        messageId: entry.id,
      });
      await persistQueue(queueRef.current.filter(q => q.id !== entry.id));
      await clearSentAttachments(scope,selectedFiles);
      if (client.selected === id && draftRef.current.trim() === text)
        updateDraft('');
    } catch (e) {
      await persistQueue(
        queueRef.current.map(q =>
          q.id === entry.id ? { ...q, status: '结果待确认' } : q,
        ),
      );
      setError(errorText(e));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };
  const stop = async () => {
    if (stopping || !thread?.activeTurnId) return;
    setStopping(true);
    setError('');
    Keyboard.dismiss();
    try {
      await client.rpc('turn/interrupt', {
        threadId: thread.id,
        turnId: thread.activeTurnId,
      });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setStopping(false);
    }
  };
  const openDetail = async (item: any) => {
    Keyboard.dismiss();
    setDetail({
      ...item,
      text: item.text?.trim() ? item.text : '此操作没有文本输出。',
      loading: !!item.image,
    });
    if (item.image && thread)
      try {
        const result = await client.rpc('artifact/read', {
          threadId: thread.id,
          path: item.image,
        });
        setDetail((prev: any) =>
          prev?.id === item.id ? { ...item, dataUri: result.dataUri } : prev,
        );
      } catch (e) {
        setDetail((prev: any) =>
          prev?.id === item.id ? { ...item, previewError: errorText(e) } : prev,
        );
      }
  };
  const openLink = async (url: string) => {
    if (!isDesktopFile(url)) {
      if (/^https?:\/\//i.test(url)) {
        try { await Linking.openURL(url); } catch { toast('无法打开此链接'); }
      } else toast('当前手机暂不支持此链接类型');
      return;
    }
    const id = client.selected;
    if (!id) return;
    if (/\.(png|jpe?g|webp)(?::\d+)?$/i.test(url)) {
      openDetail({ id: 'link:' + url, type: 'imageView', image: url });
      return;
    }
    downloadCancel.current = false;
    setDetail({ id: url, type: 'localFile', path: url, text: '正在读取文件信息…', loading: true });
    try {
      const info = await client.rpc('artifact/info', { threadId: id, path: url });
      let text = '';
      if (/^(text\/|application\/json)/.test(info.mime) && info.size <= 1024 * 1024)
        text = (await client.rpc('artifact/read', { threadId: id, path: url })).text;
      setDetail((prev: any) => prev?.id === url ? { ...prev, ...info, text, loading: false } : prev);
    } catch (e: any) {
      setDetail((prev: any) => prev?.id === url ? { ...prev, text: /ENOENT/.test(e.message) ? '电脑上的文件已不存在。' : '无法读取文件，请确认电脑在线后重试。', loading: false, failed: true } : prev);
    }
  };
  const downloadFile = async () => {
    const file = detail, threadId = client.selected;
    if (!file || !threadId || file.downloading) return;
    downloadCancel.current = false;
    let transfer: string | undefined;
    const update = (value: any) => setDetail((prev: any) => prev?.id === file.id ? { ...prev, ...value } : prev);
    if (!NativeModules.RemoteArtifacts?.begin) {
      update({ downloadError: '此开发版缺少原生下载模块，请安装 0.2.1 测试 APK。' });
      return;
    }
    update({ downloading: true, progress: 0, downloadError: '' });
    try {
      transfer = await NativeModules.RemoteArtifacts.begin(file.name, file.mime);
      let offset = 0;
      while (offset < file.size) {
        if (downloadCancel.current) throw Error('下载已取消');
        const chunk = await client.rpc('artifact/chunk', { threadId, path: file.path, version: file.version, offset });
        if (chunk.next <= offset || chunk.next > file.size) throw Error('下载数据不完整');
        await NativeModules.RemoteArtifacts.write(transfer, chunk.base64);
        offset = chunk.next;
        update({ progress: Math.round(offset / file.size * 100) });
      }
      if (downloadCancel.current) throw Error('下载已取消');
      const uri = await NativeModules.RemoteArtifacts.finish(transfer, file.size);
      transfer = undefined;
      update({ savedUri: uri, downloading: false, progress: 100 });
      toast('文件已保存到 Downloads/CodexRemote');
    } catch (e: any) {
      if (transfer) await NativeModules.RemoteArtifacts.abort(transfer).catch(() => {});
      update({ downloading: false, downloadError: e.message || '下载失败，请重试' });
    }
  };
  const rows = useMemo(() => displayRows(thread?.items ?? []), [thread?.items]),
    lastAssistant = thread?.items
      .filter(i => i.type === 'agentMessage' && i.text)
      .at(-1)?.id;
  const catalogTitle = (item: any) => shortTitle(item.title ?? titles[item.id]);
  const visibleChats = catalog.filter(
    item =>
      (!project || (item.projectId ? item.projectId === registered.find(p => normalizePath(p.path) === normalizePath(project))?.projectId : normalizePath(item.cwd) === normalizePath(project))) &&
      catalogTitle(item).toLowerCase().includes(search.toLowerCase()),
  );
  const showProjects = () => {
    Keyboard.dismiss();
    setSheet('projects');
  };
  const iconButton = (
    name: IconName,
    label: string,
    onPress: () => void,
    disabled = false,
  ) => (
    <IconButton
      name={name}
      label={label}
      onPress={onPress}
      colors={c}
      disabled={disabled}
    />
  );
  const actionRow = (
    name: IconName,
    label: string,
    action: () => void,
    extra?: string,
  ) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={action}
      style={({ pressed }) => [
        ui.sheetAction,
        { backgroundColor: pressed ? c.soft : 'transparent', borderRadius: 12 },
      ]}
    >
      <Icon name={name} color={c.text} size={21} />
      <View style={{ flex: 1 }}>
        <Text style={[ui.label, { color: c.text }]}>{label}</Text>
        {extra && (
          <Text style={[ui.muted, { color: c.muted, marginTop: 2 }]}>
            {extra}
          </Text>
        )}
      </View>
    </Pressable>
  );
  const markdownStyle = {
    body: { color: c.text, fontSize: 16, lineHeight: 26 },
    paragraph: { marginTop: 0, marginBottom: 13 },
    heading1: { color: c.text, fontSize: 26, lineHeight: 33, marginBottom: 12 },
    heading2: { color: c.text, fontSize: 22, lineHeight: 29, marginBottom: 10 },
    heading3: { color: c.text, fontSize: 18, lineHeight: 26, marginBottom: 8 },
    code_inline: { color: c.text, backgroundColor: c.soft },
    fence: { color: c.text, backgroundColor: c.code },
    code_block: { color: c.text, backgroundColor: c.code },
    link: { color: dark ? '#8ab4f8' : '#1565c0', textDecorationLine: 'underline' as const },
    blockquote: { backgroundColor: c.surface, borderColor: c.line },
  };
  const markdownRules = {
    image: (node: any) => <MarkdownImage key={node.key} source={node.attributes.src} label={node.content || '图片'}
      threadId={thread!.id} colors={c} onOpen={() => openLink(node.attributes.src)} />,
    fence: (node: any) => (
      <View
        key={node.key}
        style={[s.codeFrame, { backgroundColor: c.code, borderColor: c.line }]}
      >
        <View style={[s.codeHeader, { borderColor: c.line }]}>
          <Text style={{ color: c.muted, fontSize: 12 }}>
            {node.sourceInfo || '代码'}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="复制代码"
            onPress={() => copy(node.content)}
            style={s.copyCode}
          >
            <Icon name="copy" size={14} color={c.muted} />
            <Text style={{ color: c.muted, fontSize: 12 }}>复制</Text>
          </Pressable>
        </View>
        <ScrollView horizontal>
          <Text selectable style={[s.codeText, { color: c.text }]}>
            {node.content.trimEnd()}
          </Text>
        </ScrollView>
      </View>
    ),
  };
  const renderRow = ({ item: row }: { item: DisplayRow }) => {
    if (row.kind === 'work')
      return (
        <WorkGroup
          items={row.items!}
          colors={c}
          running={!!thread?.activeTurnId && row.id === rows.at(-1)?.id}
          onDetail={openDetail}
        />
      );
    const item = row.item;
    if (item.type === 'userMessage')
      return (
        <View style={s.userWrap}>
          <Pressable
            accessibilityLabel={item.text}
            onLongPress={() => {
              setMessage(item);
              setSheet('message');
            }}
            style={[s.userBubble, { backgroundColor: c.soft }]}
          >
            <Text selectable style={[s.messageText, { color: c.text }]}>
              {item.text}
            </Text>
            {item.attachments?.map((file:any)=><Pressable key={file.id} accessibilityLabel={'打开附件 '+file.name}
              onPress={async()=>{
                setDetail({id:file.id,type:/\.(png|jpg|jpeg|webp)$/i.test(file.name)?'imageView':'phoneAttachment',name:file.name,loading:true});
                try{const value=await client.rpc('attachment/read',{id:file.id});setDetail((previous:any)=>previous?.id===file.id?{...previous,...value,previewError:value.text,loading:false}:previous)}
                catch{setDetail((previous:any)=>previous?.id===file.id?{...previous,loading:false,previewError:'附件加载失败，请返回后重试。',text:'附件加载失败，请返回后重试。'}:previous)}
              }} style={{paddingVertical:8,flexDirection:'row',alignItems:'center',gap:8}}>
              <Icon name="file" size={16} color={c.muted}/><Text numberOfLines={1} style={{color:c.text,fontSize:13,flex:1}}>{file.name}</Text>
            </Pressable>)}
          </Pressable>
        </View>
      );
    return (
      <View style={s.assistant}>
        <Pressable
          onLongPress={() => {
            setMessage(item);
            setSheet('message');
          }}
        >
          <Markdown style={markdownStyle} rules={markdownRules} onLinkPress={url => { openLink(url); return false; }}>
            {item.text}
          </Markdown>
        </Pressable>
        {item.id === lastAssistant && !thread?.activeTurnId && (
          <View style={s.messageActions}>
            <IconButton
              name="copy"
              label="复制回复"
              colors={c}
              size={18}
              onPress={() => copy(item.text)}
            />
            <IconButton
              name="more"
              label="回复操作"
              colors={c}
              size={19}
              onPress={() => {
                setMessage(item);
                setSheet('message');
              }}
            />
          </View>
        )}
      </View>
    );
  };

  const composer = (isNew: boolean) => {
    const voiceThread=client.selected;
    const voiceScope=attachmentScope.current;
    const text = isNew ? newPrompt : draft,
      active = !isNew && !!thread?.activeTurnId,
      hasContent=!!text.trim()||attachments.length>0;
    return (
      <View style={[s.composerArea, { backgroundColor: c.bg }]}>
        {!!thread?.requests.length && !isNew && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="查看待确认请求"
            onPress={() => setSheet('requests')}
            style={[
              s.attention,
              { backgroundColor: c.surface, borderColor: c.line },
            ]}
          >
            <Icon name="clock" size={18} color={c.text} />
            <Text style={{ color: c.text, fontSize: 14, flex: 1 }}>
              需要你确认 · {thread.requests.length} 项
            </Text>
            <Icon name="chevron" color={c.muted} size={17} />
          </Pressable>
        )}
        <View
          style={[
            s.composer,
            { backgroundColor: c.surface, borderColor: c.line },
          ]}
        >
          {!!attachments.length&&<ScrollView horizontal contentContainerStyle={{padding:10,gap:10}}>
            {attachments.map(file=><View key={file.id} style={{width:120,padding:8,borderRadius:14,backgroundColor:c.soft}}>
              <Pressable accessibilityLabel={'预览附件 '+file.name} onPress={()=>{
                if(file.mime.startsWith('image/'))setDetail({id:file.id,type:'imageView',dataUri:file.uri});
                else toast(file.name+' · '+(file.size/1024).toFixed(1)+' KB');
              }}>
                {file.mime.startsWith('image/')?<Image source={{uri:file.uri}} style={{width:104,height:68,borderRadius:8}}/>:<Icon name="file" color={c.muted} size={32}/>}
                <Text numberOfLines={1} style={{fontSize:12,color:c.text,marginTop:5}}>{file.name}</Text>
                {attachmentProgress[file.id]!==undefined&&<Text style={{fontSize:11,color:c.muted}}>上传 {attachmentProgress[file.id]}%</Text>}
              </Pressable>
              <Pressable accessibilityLabel={'移除附件 '+file.name} disabled={sending} onPress={()=>saveAttachments(attachmentRef.current.filter(f=>f.id!==file.id))} style={{paddingTop:8}}><Text style={{color:c.muted,fontSize:12}}>移除</Text></Pressable>
            </View>)}
          </ScrollView>}
          <TextInput
            accessibilityLabel={isNew ? '新聊天消息' : '消息输入'}
            multiline
            placeholder={
              isNew ? '询问 Codex，或描述一个任务' : '给 Codex 发消息'
            }
            placeholderTextColor={c.muted}
            value={text}
            onChangeText={isNew ? setNewPrompt : updateDraft}
            style={[s.input, { color: c.text }]}
            textAlignVertical="top"
            maxLength={60000}
          />
          <View style={s.composerTools}>
            <View style={ui.row}>
              {iconButton('plus', '聊天操作', () => {
                Keyboard.dismiss();
                setSheet('actions');
              })}
              {!isNew && queue.length > 0 && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="待发送记录"
                  onPress={() => setSheet('queue')}
                  style={[s.queueBadge, { backgroundColor: c.soft }]}
                >
                  <Icon name="clock" color={c.muted} size={14} />
                  <Text style={{ color: c.muted, fontSize: 12 }}>
                    {queue.length}
                  </Text>
                </Pressable>
              )}
            </View>
            <View style={ui.row}>
              {!isNew && <VoiceInputButton key={voiceThread} colors={c} onError={toast} onResult={file=>{
                if(client.selected!==voiceThread || attachmentScope.current!==voiceScope)return;
                if(attachmentRef.current.length>=5){toast('每条消息最多添加 5 个附件');return;}
                saveAttachments([...attachmentRef.current,file]);
                toast('录音已添加，发送后传到电脑');
              }}/>}
              {active && hasContent && (
                <IconButton
                  name="stop"
                  label="停止任务"
                  colors={c}
                  size={17}
                  disabled={!online || stopping}
                  onPress={stop}
                />
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  active && !hasContent
                    ? '停止'
                    : isNew
                    ? '创建并发送'
                    : active
                    ? '追加要求'
                    : online
                    ? '发送'
                    : '保存待发送'
                }
                disabled={
                  active && !hasContent
                    ? !online || stopping
                    : !hasContent || sending || (isNew && !online)
                }
                onPress={active && !hasContent ? stop : isNew ? create : send}
                style={({ pressed }) => [
                  s.send,
                  {
                    backgroundColor: c.button,
                    opacity:
                      active && !hasContent
                        ? stopping
                          ? 0.35
                          : 1
                        : !hasContent || sending
                        ? 0.22
                        : pressed
                        ? 0.7
                        : 1,
                  },
                ]}
              >
                {sending ? (
                  <ActivityIndicator size="small" color={c.buttonText} />
                ) : (
                  <Icon
                    name={active && !hasContent ? 'stop' : 'up'}
                    color={c.buttonText}
                    size={21}
                  />
                )}
              </Pressable>
            </View>
          </View>
        </View>
        <Text style={[s.composerHint, { color: c.muted }]}>
          {!online
            ? connectionMessage+' · 草稿会保留'
            : active
            ? '正在电脑上工作，可随时追加要求或停止'
            : 'Codex 在你的电脑上运行'}
        </Text>
      </View>
    );
  };
  const renderSheet = () => {
    if (sheet === 'projects') {
      const options = registered;
      return (
        <>
          {screen !== 'new' &&
            actionRow('folder', '所有项目', () => {
              setProject(null);
              setSheet(null);
            })}
          {options.map(p => (
            <Pressable
              key={p.projectId}
              accessibilityRole="button"
              accessibilityLabel={p.label}
              onPress={() => {
                setProject(p.path);
                setSheet(null);
              }}
              style={ui.sheetAction}
            >
              <Icon name="folder" color={c.muted} size={21} />
              <Text style={[ui.label, { flex: 1, color: c.text }]}>
                {p.label}
              </Text>
              {project && normalizePath(project) === normalizePath(p.path) && (
                <Icon name="check" color={c.text} size={19} />
              )}
            </Pressable>
          ))}
          {!options.length && (
            <Text style={[s.emptyText, { color: c.muted }]}>
              连接电脑后，可查看可用项目。
            </Text>
          )}
        </>
      );
    }
    if (sheet === 'diagnostics')
      return <>
        <Text selectable style={{color:c.text,fontSize:12,fontFamily:'monospace',lineHeight:18}}>{JSON.stringify(client.diagnostics(),null,2)}</Text>
        {actionRow('refresh','刷新诊断日志',async()=>setDiagnosticLog(await readDiagnostics()))}
        {actionRow('copy','导出日志到下载目录',async()=>{
          try{await exportDiagnostics();toast('日志已导出到 Downloads/CodexRemote');}
          catch{toast('日志导出失败，请重试');}
        })}
        <Text style={{color:c.muted,fontSize:13,lineHeight:20,marginVertical:12}}>日志不包含配对码、令牌或聊天正文。保留最近约 3MB；下方显示最近 128KB。</Text>
        <Text selectable style={{color:c.text,fontSize:11,fontFamily:'monospace',lineHeight:17}}>{diagnosticLog||'暂无日志'}</Text>
      </>;
    if (sheet === 'connection')
      return (
        <>
          <View style={[s.connectionRow, { borderColor: c.line }]}>
            <View style={[s.deviceIcon, { backgroundColor: c.soft }]}>
              <Icon name="monitor" size={26} color={c.text} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.sheetLabel, { color: c.text }]}>我的电脑</Text>
              <Text style={[ui.muted, { color: c.muted, marginTop: 4 }]}>
                {online ? '已连接' : connectionMessage+' · 任务仍在电脑运行'}
              </Text>
            </View>
            <View
              style={[s.dot, { backgroundColor: online ? '#2e9b65' : c.muted }]}
            />
          </View>
          <Text style={[s.sectionLabel, { color: c.muted }]}>中转地址</Text>
          <Text
            selectable
            style={{ color: c.text, fontSize: 14, marginBottom: 20 }}
          >
            {client.url}
          </Text>
          {actionRow('refresh', '重新连接', () => {
            setSheet(null);
            client.connect();
          })}
          <Text style={[s.sectionLabel, {color:c.muted}]}>任务完成通知</Text>
          <Text style={{color:c.muted, fontSize:14, lineHeight:21, marginBottom:12}}>
            {notifications.enabled && notifications.permitted
              ? (notifications.running ? (notifications.connected ? '后台通知服务已连接，任务完成后会提醒。' : '后台通知服务正在连接，暂时无法实时提醒。') : '通知已开启，但后台服务未运行，请重新开启任务通知。')
              : '开启后，电脑任务完成时会在手机通知栏提醒。'}
            {'\n'}后台监听会保留常驻通知；系统强行停止 App 后需重新打开。
            {notifications.enabled && ('\n' + (notifications.batteryExempt ? '系统电池优化：已允许后台运行。' : '系统电池优化：尚未允许，退到后台或锁屏后可能延迟。'))}
            {notifications.backgroundRestricted && '\n系统已限制本应用后台活动，请在应用设置中解除。'}
            {'\n'}持续后台连接会增加耗电。部分手机还需要允许自启动、后台活动，并在最近任务中锁定 App。
          </Text>
          {actionRow('refresh', notifications.enabled ? '关闭任务完成通知' : '开启任务完成通知', async () => {
            try {setNotifications(notifications.enabled ? await disableNotifications() : await enableNotifications());}
            catch(e) {setNotifications(await notificationStatus());toast(errorText(e));}
          })}
          {actionRow('monitor', '后台运行与电池设置', async () => {
            try { await NativeModules.TaskNotifications.openBackgroundSettings(); }
            catch(e) { toast(errorText(e)); }
          })}
          {actionRow('more', '系统通知设置', () => NativeModules.TaskNotifications.openSettings())}
          {actionRow('monitor','连接诊断与日志',async()=>{setDiagnosticLog(await readDiagnostics());setSheet('diagnostics')})}
          {actionRow('close', '解除本机配对', async () => {
            await disableNotifications();
            await client.disconnect();
            client.select(undefined);
            setPaired(false);
            setThread(null);
            setScreen('home');
            setSheet(null);
            await AsyncStorage.removeItem('last-thread');
          })}
        </>
      );
    if (sheet === 'message')
      return (
        <>
          {actionRow('copy', '复制', () => {
            copy(message?.text ?? '');
            setSheet(null);
          })}
          {actionRow('file', '查看文本', () => {
            setDetail(message);
            setSheet(null);
          })}
        </>
      );
    if (sheet === 'queue')
      return queue.length ? (
        queue.map(q => (
          <View key={q.id} style={[s.outboxItem, { borderColor: c.line }]}>
            <View style={ui.row}>
              <Icon name="clock" size={15} color={c.muted} />
              <Text style={[ui.muted, { color: c.muted, flex: 1 }]}>
                {q.status}
              </Text>
              <IconButton
                name="trash"
                size={18}
                label="移除待发送记录"
                colors={c}
                onPress={() =>
                  persistQueue(queueRef.current.filter(v => v.id !== q.id))
                }
              />
            </View>
            <Text numberOfLines={4} style={[s.messageText, { color: c.text }]}>
              {q.text}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                q.status === '待发送' ? '继续编辑' : '打开聊天核对'
              }
              onPress={async () => {
                await openChat(q.threadId);
                if (q.status === '待发送') {updateDraft(q.text);saveAttachments(q.attachments??[]);}
              }}
              style={s.textAction}
            >
              <Text style={{ color: c.text, fontWeight: '600' }}>
                {q.status === '待发送' ? '继续编辑' : '打开聊天核对'}
              </Text>
              <Icon name="chevron" color={c.text} size={16} />
            </Pressable>
          </View>
        ))
      ) : (
        <Text style={[s.emptyText, { color: c.muted }]}>没有待发送的消息</Text>
      );
    if (sheet === 'requests')
      return thread?.requests.length ? thread.requests.map(r => (
        <RequestCard
          key={String(r.id)}
          request={r}
          threadId={thread.id}
          online={online}
          onError={setError}
          dark={dark}
        />
      )) : <Text style={{color:c.muted,padding:16}}>当前没有待回答或确认的问题。</Text>;
    return (
      <>
        {(screen==='chat'||screen==='new')&&actionRow('plus','添加截图或图片',()=>selectPhoneAttachments(true))}
        {(screen==='chat'||screen==='new')&&actionRow('file','添加手机文件',()=>selectPhoneAttachments(false))}
        {screen === 'chat' &&
          actionRow('refresh', '刷新聊天', () => {
            setSheet(null);
            refresh();
          })}
        {screen === 'chat' &&
          actionRow('clock', '加载完整聊天', async () => {
            const id = client.selected;
            if (!id || !client.online) return;
            setSheet(null);
            setRefreshing(true);
            try {
              await client.rpc('thread/history', { threadId: id });
              acceptThread(await client.rpc('thread/read', { threadId: id }));
              toast('聊天记录已更新');
            } catch (e) {
              setError(errorText(e));
            } finally {
              setRefreshing(false);
            }
          })}
        {actionRow(
          'clock',
          '待发送记录',
          () => setSheet('queue'),
          queue.length ? `${queue.length} 条记录` : undefined,
        )}
        {actionRow('monitor', '连接信息', () => setSheet('connection'))}
        {screen !== 'new' && actionRow('new', '新聊天', beginNew)}
      </>
    );
  };
  const sheetTitle =
    sheet === 'projects'
      ? '选择项目'
      : sheet === 'connection'
      ? '计算机'
      : sheet === 'diagnostics'
      ? '连接诊断与日志'
      : sheet === 'queue'
      ? '待发送记录'
      : sheet === 'message'
      ? '消息操作'
      : sheet === 'requests'
      ? '需要你确认'
      : '聊天操作';
  const imageDetail = detail?.type === 'imageView',
    detailTitle = imageDetail
      ? '图片'
      : detail?.type==='phoneAttachment'
      ? detail.name??'附件'
      : detail?.type === 'commandExecution'
      ? '终端输出'
      : detail?.type === 'fileChange'
      ? '文件变更'
      : detail?.type === 'localFile'
      ? detail.name ?? '文件'
      : detail
      ? workLabel(detail)
      : '详情';
  return (
    <SafeAreaView
      style={[s.root, { backgroundColor: c.bg }]}
      edges={['top', 'left', 'right', 'bottom']}
    >
      <StatusBar
        barStyle={dark ? 'light-content' : 'dark-content'}
        backgroundColor={c.bg}
      />
      <View style={s.header}>
        {screen === 'home'
          ? iconButton('menu', '打开侧栏', () => {
              Keyboard.dismiss();
              setDrawer(true);
            })
          : iconButton(
              screen === 'new' ? 'close' : 'back',
              screen === 'new' ? '取消新聊天' : '返回聊天列表',
              goHome,
            )}
        <View style={s.headerTitle}>
          <Text
            numberOfLines={1}
            style={[
              s.headerText,
              { color: c.text, fontSize: screen === 'home' ? 22 : 16 },
            ]}
          >
            {screen === 'home'
              ? 'Codex'
              : screen === 'new'
              ? '新聊天'
              : shortTitle(thread?.title ?? '聊天')}
          </Text>
        </View>
        {paired &&
          (screen === 'home'
            ? iconButton('new', '新聊天', beginNew)
            : iconButton('more', '更多操作', () => {
                Keyboard.dismiss();
                setSheet('actions');
              }))}
      </View>
      {!!error && (
        <View
          style={[s.error, { backgroundColor: dark ? '#382322' : '#fff1ef' }]}
        >
          <Text
            style={{ flex: 1, color: c.danger, fontSize: 13, lineHeight: 19 }}
          >
            {error}
          </Text>
          <IconButton
            name="close"
            label="关闭提示"
            colors={c}
            size={16}
            onPress={() => setError('')}
          />
        </View>
      )}
      {booting ? (
        <View style={s.center}>
          <ActivityIndicator color={c.muted} />
        </View>
      ) : !paired ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={s.pairBody}
        >
          <View style={[s.pairIcon, { backgroundColor: c.soft }]}>
            <Icon name="monitor" size={36} color={c.text} />
          </View>
          <Text style={[s.pairTitle, { color: c.text }]}>连接你的电脑</Text>
          <Text style={[s.pairDescription, { color: c.muted }]}>
            随时继续电脑上的聊天，查看进度，或开始新的任务。
          </Text>
          <View style={[s.pairForm, { borderColor: c.line }]}>
            <Text style={[s.fieldLabel, { color: c.muted }]}>中转地址</Text>
            <TextInput
              accessibilityLabel="中转地址"
              autoCapitalize="none"
              autoCorrect={false}
              value={url}
              onChangeText={setUrl}
              style={[s.formInput, { color: c.text, borderColor: c.line }]}
            />
            <Text style={[s.fieldLabel, { color: c.muted, marginTop: 24 }]}>
              配对码
            </Text>
            <TextInput
              accessibilityLabel="配对码"
              placeholder="输入六位配对码"
              placeholderTextColor={c.muted}
              keyboardType="number-pad"
              value={code}
              onChangeText={setCode}
              maxLength={6}
              style={[
                s.formInput,
                { color: c.text, borderColor: c.line, letterSpacing: 4 },
              ]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="开始配对"
              disabled={code.length !== 6 || connecting}
              onPress={() => {
                Keyboard.dismiss();
                setError('');
                try {
                  client.url = url.trim();
                  setConnecting(true);
                  client.connect(code.trim());
                } catch (e) {
                  setConnecting(false);
                  setError(errorText(e));
                }
              }}
              style={[
                s.primary,
                {
                  backgroundColor: c.button,
                  opacity: code.length !== 6 || connecting ? 0.4 : 1,
                },
              ]}
            >
              {connecting ? (
                <ActivityIndicator color={c.buttonText} />
              ) : (
                <Text style={[s.primaryText, { color: c.buttonText }]}>
                  连接
                </Text>
              )}
            </Pressable>
            <Text style={[s.pairFooter, { color: c.muted }]}>
              {connecting
                ? '请在电脑上确认这台设备'
                : '在电脑上启动 Bridge，即可获取配对码'}
            </Text>
          </View>
        </ScrollView>
      ) : screen === 'home' ? (
        <View style={{ flex: 1 }}>
          <View style={s.filters}>
            <Pill
              colors={c}
              onPress={() => setSheet('connection')}
              label="选择计算机"
            >
              <Icon name="monitor" size={16} color={c.muted} />
              <Text style={{ color: c.text, fontSize: 13 }}>我的电脑</Text>
              <View
                style={[
                  s.dot,
                  { backgroundColor: online ? '#2e9b65' : c.muted },
                ]}
              />
              <Icon name="down" size={14} color={c.muted} />
            </Pill>
            <Pill colors={c} onPress={showProjects} label="筛选项目">
              <Text
                numberOfLines={1}
                style={{ color: c.text, fontSize: 13, maxWidth: 125 }}
              >
                {projectLabel}
              </Text>
              <Icon name="down" size={14} color={c.muted} />
            </Pill>
          </View>
          <View
            style={[
              s.search,
              { backgroundColor: c.surface, borderColor: c.line },
            ]}
          >
            <Icon name="search" size={18} color={c.muted} />
            <TextInput
              accessibilityLabel="搜索聊天"
              value={search}
              onChangeText={setSearch}
              placeholder="搜索聊天"
              placeholderTextColor={c.muted}
              style={[s.searchInput, { color: c.text }]}
            />
            {!!search && (
              <IconButton
                name="close"
                colors={c}
                label="清除搜索"
                size={16}
                onPress={() => setSearch('')}
              />
            )}
          </View>
          <View style={s.sectionRow}>
            <Text style={[s.sectionLabel, { color: c.muted }]}>
              {search ? '搜索结果' : '最近聊天'}
            </Text>
            {refreshing && <ActivityIndicator size="small" color={c.muted} />}
          </View>
          <FlatList
            data={visibleChats}
            keyExtractor={item => item.id}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={refresh}
                tintColor={c.muted}
              />
            }
            contentContainerStyle={{
              paddingHorizontal: 14,
              paddingBottom: 24,
              flexGrow: 1,
            }}
            ListEmptyComponent={
              <View style={s.center}>
                <Icon name="new" size={32} color={c.muted} />
                <Text style={[s.emptyTitle, { color: c.text }]}>
                  {search ? '没有找到聊天' : '从电脑继续'}
                </Text>
                <Text style={[s.emptyText, { color: c.muted }]}>
                  {search
                    ? '试试其他关键词'
                    : '在这里查看已有聊天，或开始一项新任务。'}
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={catalogTitle(item)}
                onPress={() => openChat(item.id)}
                style={({ pressed }) => [
                  s.chatRow,
                  { backgroundColor: pressed ? c.soft : 'transparent' },
                ]}
              >
                <View style={[s.chatIcon, { backgroundColor: c.surface }]}>
                  {online&&item.status==='active'?<ActivityIndicator accessibilityLabel="会话正在进行" size="small" color={c.text}/>:<Icon name="file" size={19} color={c.muted} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    numberOfLines={1}
                    style={[s.chatTitle, { color: c.text }]}
                  >
                    {catalogTitle(item)}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[s.chatSubtitle, { color: c.muted }]}
                  >
                    {projects.find(
                      p =>
                        item.projectId ? p.projectId === item.projectId : normalizePath(p.path ?? '') === normalizePath(item.cwd),
                    )?.label ?? pathName(item.cwd)}
                  </Text>
                </View>
                {item.status==='active'&&<Text style={{color:c.muted,fontSize:12,marginRight:8}}>{online?'进行中':'状态待同步'}</Text>}
                <Icon name="chevron" size={16} color={c.muted} />
              </Pressable>
            )}
          />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          {screen === 'new' ? (
            <>
              <View style={s.newProject}>
                <Pill colors={c} onPress={showProjects} label="选择项目">
                  <Icon name="folder" size={16} color={c.muted} />
                  <Text style={{ color: c.text, fontSize: 13 }}>
                    {selectedProject?.label ?? '选择项目'}
                  </Text>
                  <Icon name="down" size={14} color={c.muted} />
                </Pill>
              </View>
              <View style={s.newBody}>
                <Icon name="terminal" size={39} color={c.text} />
                <Text style={[s.newTitle, { color: c.text }]}>
                  从一个想法开始
                </Text>
                <Text style={[s.newSubtitle, { color: c.muted }]}>
                  描述你想完成的任务
                </Text>
              </View>
              {composer(true)}
            </>
          ) : (
            <>
              <View style={s.threadMeta}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="聊天连接信息"
                  onPress={() => setSheet('connection')}
                  style={ui.row}
                >
                  <View
                    style={[
                      s.dot,
                      { backgroundColor: online ? '#2e9b65' : c.muted },
                    ]}
                  />
                  <Text
                    numberOfLines={1}
                    style={{ color: c.muted, fontSize: 12 }}
                  >
                    {refreshing ? '正在同步最新状态…' : online
                      ? projects.find(
                          p =>
                            normalizePath(p.path ?? '') ===
                            normalizePath(thread?.cwd ?? ''),
                        )?.label ?? pathName(thread?.cwd ?? '')
                      : connectionMessage+' · 正在显示已保存的聊天'}
                  </Text>
                </Pressable>
              </View>
              <View style={{ flex: 1 }}>
                {opening && !thread ? (
                  <View style={s.center}>
                    <ActivityIndicator color={c.muted} />
                    <Text style={[s.emptyText, { color: c.muted }]}>正在从电脑加载这段聊天…</Text>
                  </View>
                ) : (
                  <FlatList
                    ref={list}
                    data={[...rows].reverse()}
                    inverted
                    keyExtractor={row => row.id}
                    renderItem={({item}) => (
                      <MemoTranscriptRow
                        row={item} render={renderRow} dark={dark} threadId={thread?.id}
                        actions={item.item?.id === lastAssistant && !thread?.activeTurnId}
                        running={item.kind === 'work' && !!thread?.activeTurnId && item.id === rows.at(-1)?.id}
                      />
                    )}
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={[
                      s.transcript,
                      !rows.length && { flex: 1 },
                    ]}
                    ListEmptyComponent={
                      <View style={s.center}>
                        <Text style={[s.emptyText, { color: c.muted }]}>
                          {!thread ? '这段聊天尚未加载' : online
                            ? '发送消息，继续这段聊天'
                            : '已保存的聊天暂无内容'}
                        </Text>
                        {!thread && client.selected && <Pressable accessibilityRole="button" accessibilityLabel="重试加载聊天"
                          onPress={() => openChat(client.selected!)} style={{ padding: 16 }}>
                          <Text style={{ color: dark ? '#8ab4f8' : '#1565c0' }}>重试加载</Text>
                        </Pressable>}
                      </View>
                    }
                    onContentSizeChange={() => {
                      if (follow.current)
                        list.current?.scrollToOffset({ offset: 0, animated: false });
                    }}
                    onScrollBeginDrag={() => {
                      dragging.current = true;
                    }}
                    onScrollEndDrag={() => {
                      setTimeout(() => {
                        dragging.current = false;
                      }, 300);
                    }}
                    onScroll={e => {
                      const n = e.nativeEvent,
                        distance = n.contentOffset.y;
                      if (distance < 100) {
                        follow.current = true;
                        setJump(false);
                      } else if (dragging.current) {
                        follow.current = false;
                        setJump(true);
                      }
                    }}
                    scrollEventThrottle={80}
                  />
                )}{' '}
                {jump && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="回到最新消息"
                    onPress={() => {
                      follow.current = true;
                      list.current?.scrollToOffset({ offset: 0, animated: true });
                      setJump(false);
                    }}
                    style={[
                      s.jump,
                      { backgroundColor: c.bg, borderColor: c.line },
                    ]}
                  >
                    <Icon name="arrowDown" color={c.text} size={19} />
                  </Pressable>
                )}
              </View>
              {composer(false)}
            </>
          )}
        </KeyboardAvoidingView>
      )}
      {!!notice && (
        <View
          pointerEvents="none"
          style={[
            s.toast,
            {
              backgroundColor: dark ? '#eeeeee' : '#242424',
              bottom: screen === 'home' ? 28 : 150,
            },
          ]}
        >
          <Text style={{ color: dark ? '#171717' : '#fff', fontSize: 13 }}>
            {notice}
          </Text>
        </View>
      )}

      <Modal
        visible={drawer}
        transparent
        animationType="none"
        onRequestClose={closeDrawer}
      >
        <View style={s.overlay}>
          <Pressable
            accessibilityLabel="关闭侧栏"
            onPress={closeDrawer}
            style={StyleSheet.absoluteFill}
          />
          <Animated.View
            style={[
              s.drawer,
              {
                width: Math.min(width * 0.88, 360),
                backgroundColor: c.surface,
                transform: [{ translateX: drawerX }],
              },
            ]}
          >
            <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
              <View style={s.drawerHeader}>
                <Text
                  style={{ fontSize: 22, fontWeight: '600', color: c.text }}
                >
                  Codex
                </Text>
                {iconButton('close', '关闭侧栏', closeDrawer)}
              </View>
              <View
                style={[
                  s.search,
                  {
                    backgroundColor: c.bg,
                    borderColor: c.line,
                    marginHorizontal: 14,
                  },
                ]}
              >
                <Icon name="search" size={17} color={c.muted} />
                <TextInput
                  accessibilityLabel="侧栏搜索聊天"
                  placeholder="搜索聊天"
                  placeholderTextColor={c.muted}
                  value={search}
                  onChangeText={setSearch}
                  style={[s.searchInput, { color: c.text }]}
                />
              </View>
              <View style={{ paddingHorizontal: 18 }}>
                {actionRow('new', '新聊天', beginNew)}
                {actionRow('folder', projectLabel, () => {
                  closeDrawer();
                  setSheet('projects');
                })}
              </View>
              <Text
                style={[
                  s.sectionLabel,
                  { color: c.muted, marginLeft: 24, marginTop: 20 },
                ]}
              >
                最近
              </Text>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{
                  paddingHorizontal: 14,
                  paddingBottom: 20,
                }}
              >
                {visibleChats.map(item => (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityLabel={'打开聊天 ' + catalogTitle(item)}
                    onPress={() => openChat(item.id)}
                    style={[
                      s.drawerChat,
                      {flexDirection:'row',alignItems:'center'},
                      {
                        backgroundColor:
                          client.selected === item.id ? c.soft : 'transparent',
                      },
                    ]}
                  >
                    {online&&item.status==='active'&&<ActivityIndicator accessibilityLabel="侧栏会话正在进行" size="small" color={c.text} style={{marginRight:8}}/>}
                    <Text
                      numberOfLines={1}
                      style={{ color: c.text, fontSize: 14 }}
                    >
                      {catalogTitle(item)}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
              <View style={[s.drawerFooter, { borderColor: c.line }]}>
                {actionRow(
                  'monitor',
                  '我的电脑',
                  () => {
                    closeDrawer();
                    setSheet('connection');
                  },
                  online ? '已连接' : '离线',
                )}
              </View>
            </SafeAreaView>
          </Animated.View>
        </View>
      </Modal>
      <Modal
        visible={!!sheet}
        transparent
        animationType="slide"
        onRequestClose={() => setSheet(null)}
      >
        <KeyboardAvoidingView
          style={[s.overlay, { justifyContent: 'flex-end' }]}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable
            accessibilityLabel="关闭面板"
            onPress={() => setSheet(null)}
            style={StyleSheet.absoluteFill}
          />
          <View
            style={[
              s.sheet,
              {
                backgroundColor: c.bg,
                paddingBottom: Math.max(insets.bottom, 16),
              },
            ]}
          >
            <View style={[s.handle, { backgroundColor: c.line }]} />
            <View style={s.sheetHeader}>
              <Text style={[s.sheetTitle, { color: c.text }]}>
                {sheetTitle}
              </Text>
              {iconButton('close', '关闭面板', () => setSheet(null))}
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{
                paddingHorizontal: 20,
                paddingBottom: 16,
              }}
            >
              {renderSheet()}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal
        visible={!!detail}
        animationType="slide"
        onRequestClose={() => { downloadCancel.current = true; setDetail(null); }}
      >
        <SafeAreaView
          style={[s.root, { backgroundColor: imageDetail ? '#000' : c.bg }]}
        >
          <View style={s.header}>
            <IconButton
              name="close"
              label="关闭详情"
              colors={imageDetail ? { ...c, text: '#fff' } : c}
              onPress={() => { downloadCancel.current = true; setDetail(null); }}
            />
            <Text
              style={[
                s.headerText,
                {
                  color: imageDetail ? '#fff' : c.text,
                  flex: 1,
                  textAlign: 'center',
                },
              ]}
            >
              {detailTitle}
            </Text>
            {imageDetail ? (
              <View style={{ width: 42 }} />
            ) : (
              iconButton('copy', '复制详情', () => copy(detail?.text ?? ''))
            )}
          </View>
          {detail?.type === 'localFile' && <View style={{ padding: 20, borderBottomWidth: 1, borderColor: c.line }}>
            {!!detail.name && <Text selectable style={{ color: c.text, fontSize: 16 }}>{detail.name}</Text>}
            {detail.size !== undefined && <Text style={{ color: c.muted, marginTop: 8 }}>{(detail.size / 1024 / 1024).toFixed(2)} MB · 电脑上的文件</Text>}
            {detail.loading ? <ActivityIndicator color={c.muted} /> : !detail.failed && <>
              <Pressable accessibilityRole="button" accessibilityLabel={detail.downloading ? '取消下载' : detail.savedUri ? '打开已下载文件' : '下载文件'}
                onPress={detail.downloading ? () => { downloadCancel.current = true; } : detail.savedUri ? async () => {
                  try { await NativeModules.RemoteArtifacts.open(detail.savedUri, detail.mime); } catch (e: any) { toast(e.message); }
                } : downloadFile}
                style={{ backgroundColor: c.button, padding: 14, borderRadius: 18, marginTop: 16, alignItems: 'center' }}>
                <Text style={{ color: c.buttonText }}>{detail.downloading ? `下载中 ${detail.progress}% · 取消` : detail.savedUri ? '打开文件' : '下载到手机'}</Text>
              </Pressable>
              {!!detail.savedUri && <Text style={{ color: c.muted, marginTop: 12 }}>已保存到 Downloads/CodexRemote</Text>}
              {!!detail.downloadError && <Text style={{ color: c.danger, marginTop: 12 }}>{detail.downloadError}</Text>}
            </>}
          </View>}
          {imageDetail ? (
            <View style={{ flex: 1, justifyContent: 'center' }}>
              {detail?.loading ? (
                <ActivityIndicator color="#fff" />
              ) : detail?.dataUri ? (
                <Image
                  accessibilityLabel="聊天图片预览"
                  source={{ uri: detail.dataUri }}
                  style={{ width: '100%', height: '85%' }}
                  resizeMode="contain"
                />
              ) : (
                <Text
                  style={{ color: '#fff', textAlign: 'center', padding: 24 }}
                >
                  {detail?.previewError ?? '无法加载图片'}
                </Text>
              )}
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ padding: 20 }}>
              <Text selectable style={[s.detailText, { color: c.text }]}>
                {detail?.text}
              </Text>
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
const MemoTranscriptRow = React.memo(
  ({row, render}: {
    row: DisplayRow;
    render: (info: {item: DisplayRow}) => React.ReactElement;
    dark: boolean;
    threadId?: string;
    actions: boolean;
    running: boolean;
  }) => render({item: row}),
  (a, b) => {
    if (a.dark !== b.dark || a.threadId !== b.threadId || a.actions !== b.actions ||
        a.running !== b.running || a.row.kind !== b.row.kind || a.row.id !== b.row.id) return false;
    if (a.row.kind === 'work' && b.row.kind === 'work') {
      return a.row.items!.length === b.row.items!.length &&
        a.row.items!.every((item, i) => item === b.row.items![i]);
    }
    return a.row.item === b.row.item;
  },
);

function WorkGroup({
  items,
  colors: c,
  running,
  onDetail,
}: {
  items: any[];
  colors: Colors;
  running: boolean;
  onDetail: (item: any) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={s.work}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={expanded ? '收起工作过程' : '展开工作过程'}
        onPress={() => setExpanded(!expanded)}
        style={s.workHeader}
      >
        {running ? (
          <ActivityIndicator size="small" color={c.muted} />
        ) : (
          <Icon name="check" color={c.muted} size={16} />
        )}
        <Text style={{ color: c.muted, fontSize: 14, flex: 1 }}>
          {running
            ? '正在工作…'
            : items.length === 1
            ? workLabel(items[0])
            : `已完成 ${items.length} 项操作`}
        </Text>
        <Icon name={expanded ? 'down' : 'chevron'} size={15} color={c.muted} />
      </Pressable>
      {expanded && (
        <View style={[s.workItems, { borderColor: c.line }]}>
          {items.map(item => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={workLabel(item)}
              onPress={() => onDetail(item)}
              style={s.workItem}
            >
              <Icon
                name={
                  item.type === 'imageView'
                    ? 'image'
                    : item.type === 'fileChange'
                    ? 'file'
                    : item.type === 'commandExecution'
                    ? 'terminal'
                    : 'clock'
                }
                color={c.muted}
                size={17}
              />
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.text, fontSize: 13 }}>
                  {workLabel(item)}
                </Text>
                {!!item.text && (
                  <Text
                    numberOfLines={1}
                    style={{ color: c.muted, fontSize: 12, marginTop: 3 }}
                  >
                    {item.text.trim().slice(0, 100)}
                  </Text>
                )}
              </View>
              <Icon name="chevron" color={c.muted} size={14} />
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  root: { flex: 1 },
  header: {
    height: 56,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: { flex: 1, alignItems: 'center', paddingHorizontal: 6 },
  headerText: { fontSize: 16, fontWeight: '600' },
  filters: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 16,
  },
  dot: { height: 6, width: 6, borderRadius: 4 },
  search: {
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginHorizontal: 18,
  },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 0, height: 40 },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 8,
  },
  sectionLabel: { fontSize: 12, fontWeight: '500', marginBottom: 10 },
  chatRow: {
    minHeight: 70,
    paddingHorizontal: 10,
    paddingVertical: 13,
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },
  chatIcon: {
    width: 37,
    height: 37,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatTitle: { fontSize: 15, lineHeight: 22, fontWeight: '500' },
  chatSubtitle: { fontSize: 12, lineHeight: 18, marginTop: 3 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  emptyTitle: { fontSize: 20, fontWeight: '500', marginTop: 18 },
  emptyText: {
    fontSize: 14,
    lineHeight: 23,
    textAlign: 'center',
    marginTop: 10,
  },
  error: {
    marginHorizontal: 16,
    marginBottom: 8,
    paddingLeft: 13,
    paddingVertical: 4,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  threadMeta: {
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 8,
    paddingHorizontal: 20,
  },
  transcript: { flexGrow: 1, justifyContent: 'flex-end', paddingTop: 16, paddingBottom: 24, paddingHorizontal: 20 },
  userWrap: { alignItems: 'flex-end', marginBottom: 22, marginTop: 5 },
  userBubble: {
    maxWidth: '91%',
    paddingHorizontal: 17,
    paddingVertical: 12,
    borderRadius: 23,
  },
  messageText: { fontSize: 16, lineHeight: 25 },
  assistant: { marginBottom: 16, paddingTop: 1 },
  messageActions: {
    flexDirection: 'row',
    gap: 0,
    marginLeft: -11,
    marginTop: -6,
  },
  composerArea: { paddingHorizontal: 12, paddingTop: 8 },
  composer: {
    borderWidth: 1,
    borderRadius: 27,
    paddingTop: 9,
    paddingHorizontal: 8,
    paddingBottom: 7,
  },
  input: {
    minHeight: 45,
    maxHeight: 150,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    fontSize: 16,
    lineHeight: 23,
  },
  composerTools: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 3,
  },
  send: {
    height: 35,
    width: 35,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerHint: {
    fontSize: 10,
    lineHeight: 17,
    textAlign: 'center',
    paddingTop: 6,
    paddingBottom: 3,
  },
  queueBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 14,
  },
  attention: {
    flexDirection: 'row',
    gap: 9,
    padding: 12,
    borderWidth: 1,
    borderRadius: 14,
    marginBottom: 9,
  },
  newProject: { alignItems: 'center', paddingTop: 10 },
  newBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 35,
  },
  newTitle: { fontSize: 27, fontWeight: '600', marginTop: 21 },
  newSubtitle: { fontSize: 14, marginTop: 11 },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 10,
    zIndex: 20,
    maxWidth: '88%',
  },
  jump: {
    position: 'absolute',
    bottom: 12,
    alignSelf: 'center',
    height: 36,
    width: 36,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
  },
  overlay: { flex: 1, backgroundColor: '#00000055' },
  drawer: { height: '100%', elevation: 10 },
  drawerHeader: {
    height: 66,
    paddingLeft: 24,
    paddingRight: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  drawerChat: {
    paddingHorizontal: 13,
    paddingVertical: 14,
    borderRadius: 11,
    marginBottom: 2,
  },
  drawerFooter: { paddingHorizontal: 18, borderTopWidth: 1, paddingTop: 7 },
  sheet: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    maxHeight: '85%',
    minHeight: 180,
  },
  handle: {
    width: 34,
    height: 4,
    borderRadius: 3,
    alignSelf: 'center',
    marginTop: 10,
  },
  sheetHeader: {
    paddingLeft: 23,
    paddingRight: 12,
    paddingTop: 7,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetTitle: { fontSize: 18, fontWeight: '600' },
  sheetLabel: { fontSize: 16, fontWeight: '500' },
  connectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingVertical: 10,
    paddingBottom: 24,
    marginBottom: 20,
    borderBottomWidth: 1,
  },
  deviceIcon: {
    height: 50,
    width: 50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outboxItem: { paddingBottom: 15, marginBottom: 15, borderBottomWidth: 1 },
  textAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingVertical: 13,
  },
  work: { marginBottom: 19 },
  workHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 10,
    minHeight: 40,
  },
  workItems: {
    marginLeft: 7,
    paddingLeft: 14,
    borderLeftWidth: 1,
    marginTop: 5,
  },
  workItem: {
    minHeight: 51,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  codeFrame: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 15,
    marginTop: 5,
  },
  codeHeader: {
    height: 36,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  copyCode: { flexDirection: 'row', alignItems: 'center', gap: 5, padding: 6 },
  codeText: {
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 21,
    padding: 14,
  },
  detailText: { fontFamily: 'monospace', fontSize: 13, lineHeight: 22 },
  pairBody: {
    paddingHorizontal: 26,
    paddingTop: 40,
    paddingBottom: 35,
    alignItems: 'center',
  },
  pairIcon: {
    height: 74,
    width: 74,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pairTitle: { fontSize: 28, fontWeight: '600', marginTop: 24 },
  pairDescription: {
    fontSize: 15,
    lineHeight: 24,
    textAlign: 'center',
    marginTop: 13,
    maxWidth: 280,
  },
  pairForm: { width: '100%', marginTop: 35, paddingTop: 25, borderTopWidth: 1 },
  fieldLabel: { fontSize: 12, marginBottom: 9 },
  formInput: {
    height: 49,
    borderBottomWidth: 1,
    fontSize: 16,
    paddingHorizontal: 1,
  },
  primary: {
    height: 48,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 28,
  },
  primaryText: { fontSize: 15, fontWeight: '600' },
  pairFooter: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 16,
  },
});
