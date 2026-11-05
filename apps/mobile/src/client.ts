import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import { DEFAULT_RELAY_URL } from './config';
export type Thread = {
  id: string;
  title: string;
  cwd: string;
  model?: string;
  revision: number;
  activeTurnId?: string;
  lastTurnStatus?: string;
  items: any[];
  requests: any[];
};
export class RemoteClient {
  ws?: WebSocket;
  epoch = '';
  online = false;
  url = DEFAULT_RELAY_URL;
  selected?: string;
  seq = 0;
  stopped = false;
  credentials?: { deviceId: string; token: string };
  listeners = new Set<(m: any) => void>();
  retry?: ReturnType<typeof setTimeout>;
  pending = new Map<
    string,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  emit(m: any) {
    for (const l of this.listeners) l(m);
  }
  async restore() {
    const s = await Keychain.getGenericPassword({ service: 'codex-remote' });
    if (s) {
      this.credentials = JSON.parse(s.password);
      this.url = (await AsyncStorage.getItem('relay-url')) ?? this.url;
      this.emit({ type: 'restored' });
      this.connect();
    }
  }
  connect(code?: string) {
    if (
      !this.url.startsWith('wss://') &&
      !/^ws:\/\/(10\.0\.2\.2|127\.0\.0\.1|localhost)(:|\/)/.test(this.url)
    )
      throw Error('公网地址必须使用 wss://');
    this.stopped = false;
    if (this.retry !== undefined) clearTimeout(this.retry);
    this.ws?.close();
    const socket = new WebSocket(this.url);
    this.ws = socket;
    socket.onopen = () =>
      socket.send(
        JSON.stringify(
          code
            ? { type: 'pair.request', code, name: 'Codex Remote Android' }
            : { type: 'device.auth', ...this.credentials },
        ),
      );
    socket.onmessage = async event => {
      try {
        const m = JSON.parse(event.data);
        if (m.type === 'paired') {
          this.credentials = { deviceId: m.deviceId, token: m.token };
          await Keychain.setGenericPassword(
            'device',
            JSON.stringify(this.credentials),
            { service: 'codex-remote' },
          );
          await AsyncStorage.setItem('relay-url', this.url);
          this.epoch = m.epoch;
          this.online = true;
          this.emit({ type: 'connected' });
        }
        if (m.type === 'host') {
          this.epoch = m.epoch;
          this.online = m.online;
          this.emit({ type: m.online ? 'connected' : 'offline' });
        }
        if (m.type === 'event') {
          if (m.epoch !== this.epoch) return;
          this.seq = m.seq;
        }
        if (m.type === 'command.result' || m.type === 'outcome.unknown') {
          const id = m.id.slice(m.id.indexOf(':') + 1),
            p = this.pending.get(id);
          if (p) {
            clearTimeout(p.timer);
            this.pending.delete(id);
            m.error || m.type === 'outcome.unknown'
              ? p.reject(
                  Error(m.error ?? '执行结果未知，请刷新核对；不会自动重发'),
                )
              : p.resolve(m.result);
          }
        }
        this.emit(m);
      } catch (e) {
        this.emit({ type: 'error', error: String(e) });
      }
    };
    socket.onclose = e => {
      if (this.ws !== socket) return;
      this.online = false;
      this.emit({ type: 'offline' });
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(Error('连接中断，请刷新确认执行结果'));
      }
      this.pending.clear();
      if (e.code === 4003) {
        this.stopped = true;
        this.emit({ type: 'error', error: '设备授权无效，请重新配对' });
      }
      if (!this.stopped && this.credentials)
        this.retry = setTimeout(() => this.connect(), 2500);
    };
    socket.onerror = () =>
      this.emit({ type: 'error', error: '无法连接中转，请检查地址与网络' });
  }
  rpc(method: string, params: any = {}): Promise<any> {
    if (!this.online || this.ws?.readyState !== 1)
      return Promise.reject(Error('电脑离线，请等待连接恢复'));
    const id =
      Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error('等待超时，请刷新确认，避免重复发送'));
      }, 35000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws!.send(
        JSON.stringify({
          type: 'command',
          id,
          epoch: this.epoch,
          method,
          params,
        }),
      );
    });
  }
  async disconnect() {
    this.stopped = true;
    if (this.retry !== undefined) clearTimeout(this.retry);
    this.ws?.close();
    this.credentials = undefined;
    await Keychain.resetGenericPassword({ service: 'codex-remote' });
  }
}
export const client = new RemoteClient();
