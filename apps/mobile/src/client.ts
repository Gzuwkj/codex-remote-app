import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import { DEFAULT_RELAY_URL } from './config';
import { applyThreadUpdate } from '../../../packages/protocol/src/stream';
import { logDiagnostic } from './diagnostics';
import { diagnosticError } from '../../../packages/protocol/src/diagnostics';
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
  private foreground = true;
  private authenticated = false;
  private heartbeatSupported = false;
  private lastReceived = 0;
  private authTimer?: ReturnType<typeof setTimeout>;
  private heartbeatTimer?: ReturnType<typeof setTimeout>;
  private probeTimer?: ReturnType<typeof setTimeout>;
  private probePromise?: Promise<boolean>;
  private probeResolve?: (alive: boolean) => void;
  private pingId?: string;
  private connectionId = '';
  private latest = new Map<string, Thread>();
  private recovering = new Set<string>();
  private events = new Map<string, any>();
  private eventTimer?: ReturnType<typeof setTimeout>;
  credentials?: { deviceId: string; token: string };
  listeners = new Set<(m: any) => void>();
  retry?: ReturnType<typeof setTimeout>;
  pending = new Map<
    string,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
      method: string;
      params: any;
    }
  >();
  emit(m: any) {
    for (const l of this.listeners) l(m);
  }
  diagnostics() {
    return {
      version: '0.5.0',
      url: this.url
        .replace(/[?#].*$/, '')
        .replace(/\/\/[^/@]+@/, '//[redacted]@'),
      connectionId: this.connectionId,
      online: this.online,
      foreground: this.foreground,
      authenticated: this.authenticated,
      socketState: this.ws?.readyState ?? 3,
      epoch: this.epoch,
      threadId: this.selected,
      count: this.pending.size,
      lastReceivedAt: this.lastReceived,
    };
  }
  private clearTransport() {
    if (this.authTimer) clearTimeout(this.authTimer);
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    if (this.probeTimer) clearTimeout(this.probeTimer);
    if (this.eventTimer) clearTimeout(this.eventTimer);
    this.authTimer =
      this.heartbeatTimer =
      this.probeTimer =
      this.eventTimer =
        undefined;
    this.events.clear();
    this.authenticated = false;
    this.probeResolve?.(false);
    this.probeResolve = undefined;
    this.probePromise = undefined;
    this.pingId = undefined;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(Error('连接中断，执行结果请刷新核对；不会自动重发'));
    }
    this.pending.clear();
  }
  private retire(socket: WebSocket, retry = true) {
    if (this.ws !== socket) return;
    this.ws = undefined;
    this.online = false;
    this.clearTransport();
    logDiagnostic(
      'connection.retired',
      { connectionId: this.connectionId, reason: retry ? 'retry' : 'closed' },
      'WARN',
    );
    socket.close();
    this.emit({ type: 'offline', reason:'network' });
    if (retry && !this.stopped && this.credentials) {
      if (this.retry) clearTimeout(this.retry);
      this.retry = setTimeout(() => this.connect(), 2500);
    }
  }
  private monitor() {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    if (!this.foreground || !this.authenticated || this.stopped) return;
    this.heartbeatTimer = setTimeout(() => {
      if (Date.now() - this.lastReceived >= 15000) this.probe();
      this.monitor();
    }, 15000);
  }
  private probe(): Promise<boolean> {
    if (this.probePromise) return this.probePromise;
    const socket = this.ws;
    if (!socket || socket.readyState !== 1 || !this.authenticated)
      return Promise.resolve(false);
    if (!this.heartbeatSupported) {
      this.connect();
      return Promise.resolve(false);
    }
    this.pingId =
      Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    this.probePromise = new Promise(resolve => {
      this.probeResolve = resolve;
    });
    const result = this.probePromise;
    this.probeTimer = setTimeout(() => {
      if (this.ws === socket) this.retire(socket);
    }, 6000);
    logDiagnostic('connection.probe', {
      connectionId: this.connectionId,
      id: this.pingId,
    });
    try {
      socket.send(JSON.stringify({ type: 'connection.ping', id: this.pingId }));
    } catch {
      this.retire(socket);
    }
    return result;
  }
  setForeground(active: boolean) {
    logDiagnostic('app.visibility', { foreground: active });
    this.foreground = active;
    if (!active) {
      if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
      if (this.probeTimer) clearTimeout(this.probeTimer);
      this.probeTimer = undefined;
      this.probeResolve?.(false);
      this.probeResolve = undefined;
      this.probePromise = undefined;
      this.pingId = undefined;
    } else this.monitor();
  }
  async resume() {
    this.setForeground(true);
    if (!this.credentials) return false;
    if (this.ws?.readyState === 0) return false;
    if (!this.authenticated || this.ws?.readyState !== 1) {
      this.connect();
      return false;
    }
    return this.probe();
  }
  select(id?: string) {
    this.selected = id;
    for (const key of this.latest.keys())
      if (key !== id) this.latest.delete(key);
    if (this.online && this.ws?.readyState === 1)
      this.ws.send(JSON.stringify({ type: 'thread.select', threadId: id }));
  }
  private accept(next: Thread) {
    const previous = this.latest.get(next.id);
    if (previous && previous.revision >= next.revision) return previous;
    if (previous) {
      const items = new Map(previous.items.map(i => [i.id, i]));
      next = {
        ...next,
        items: next.items.map(i => {
          const p = items.get(i.id);
          return p &&
            p.type === i.type &&
            p.text === i.text &&
            p.status === i.status &&
            p.image === i.image && JSON.stringify(p.attachments??[])===JSON.stringify(i.attachments??[])
            ? p
            : i;
        }),
      };
    }
    if (next.id === this.selected) this.latest.set(next.id, next);
    return next;
  }
  private deliver(m: any) {
    const thread = this.latest.get(m.thread.id) ?? m.thread;
    if (thread.id !== this.selected) return;
    this.emit({ ...m, method: 'thread.snapshot', thread });
    // Acknowledge after React has had two frames to commit the visible state.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (this.ws?.readyState === 1 && m.epoch === this.epoch)
          this.ws.send(
            JSON.stringify({
              type: 'stream.applied',
              threadId: thread.id,
              revision: thread.revision,
              sentAtMs: m.sentAtMs,
              paintedAtMs: Date.now(),
            }),
          );
      }),
    );
  }
  private stream(m: any, next: Thread, previous?: Thread) {
    this.accept(next);
    if (
      !previous ||
      previous.activeTurnId !== next.activeTurnId ||
      JSON.stringify(previous.requests) !== JSON.stringify(next.requests)
    ) {
      this.events.delete(next.id);
      this.deliver({ ...m, thread: next });
      return;
    }
    this.events.set(next.id, { ...m, thread: next });
    if (!this.eventTimer)
      this.eventTimer = setTimeout(() => {
        this.eventTimer = undefined;
        const pending = [...this.events.values()];
        this.events.clear();
        for (const event of pending) this.deliver(event);
      }, 60);
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
    const previous = this.ws;
    this.ws = undefined;
    this.online = false;
    this.clearTransport();
    previous?.close();
    this.emit({ type: 'offline', reason:'reconnecting' });
    this.connectionId =
      Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    logDiagnostic('connection.connecting', {
      connectionId: this.connectionId,
      url: this.url,
      threadId: this.selected,
    });
    const socket = new WebSocket(this.url);
    this.ws = socket;
    this.authTimer = setTimeout(() => this.retire(socket), 15000);
    socket.onopen = () => {
      if (this.ws !== socket) return;
      logDiagnostic('connection.socket-open', {
        connectionId: this.connectionId,
      });
      socket.send(
        JSON.stringify(
          code
            ? {
                type: 'pair.request',
                code,
                name: 'Codex Remote Android',
                snapshotDeltas: true,
              }
            : {
                type: 'device.auth',
                ...this.credentials,
                snapshotDeltas: true,
                threadId: this.selected,
              },
        ),
      );
    };
    socket.onmessage = async event => {
      if (this.ws !== socket) {
        logDiagnostic('connection.stale-message-ignored');
        return;
      }
      try {
        const m = JSON.parse(event.data);
        this.lastReceived = Date.now();
        if (m.type === 'pair.pending') {
          if (this.authTimer) clearTimeout(this.authTimer);
          this.authTimer = setTimeout(() => this.retire(socket, false), 70000);
        }
        if (m.type === 'paired') {
          logDiagnostic('connection.paired', {
            connectionId: this.connectionId,
          });
          this.credentials = { deviceId: m.deviceId, token: m.token };
          await Keychain.setGenericPassword(
            'device',
            JSON.stringify(this.credentials),
            { service: 'codex-remote' },
          );
          await AsyncStorage.setItem('relay-url', this.url);
          if (this.ws !== socket) return;
          if (this.authTimer) clearTimeout(this.authTimer);
          this.authenticated = true;
          this.heartbeatSupported = m.connectionPing === true;
          this.monitor();
          this.epoch = m.epoch;
          this.online = true;
          this.emit({ type: 'connected' });
        }
        if (m.type === 'host' || m.type === 'connection.pong') {
          if (m.type === 'connection.pong' && m.id !== this.pingId) return;
          const changed =
            !this.authenticated ||
            this.online !== m.online ||
            this.epoch !== m.epoch;
          logDiagnostic(
            m.type === 'host' ? 'connection.authenticated' : 'connection.pong',
            {
              connectionId: this.connectionId,
              online: m.online,
              epoch: m.epoch,
              id: m.id,
            },
          );
          if (this.authTimer) clearTimeout(this.authTimer);
          this.authenticated = true;
          if (m.connectionPing === true) this.heartbeatSupported = true;
          this.monitor();
          if (m.epoch !== this.epoch) {
            this.latest.clear();
            this.events.clear();
          }
          this.epoch = m.epoch;
          this.online = m.online;
          if (changed) this.emit({ type: m.online ? 'connected' : 'offline', reason:m.online?undefined:'host' });
          if (m.type === 'connection.pong') {
            if (this.probeTimer) clearTimeout(this.probeTimer);
            this.probeTimer = undefined;
            this.probeResolve?.(true);
            this.probeResolve = undefined;
            this.probePromise = undefined;
            this.pingId = undefined;
            return;
          }
        }
        if (m.type === 'event') {
          if (m.epoch !== this.epoch) return;
          this.seq = m.seq;
          if (m.method === 'thread.snapshot') {
            const previous = this.latest.get(m.thread.id);
            this.stream(m, m.thread, previous);
            return;
          }
          if (m.method === 'thread.update') {
            const id = m.update.threadId,
              previous = this.latest.get(id);
            if (previous && previous.revision >= m.update.revision) return;
            try {
              if (!previous) throw Error('STREAM_REVISION_GAP');
              this.stream(m, applyThreadUpdate(previous, m.update), previous);
            } catch {
              logDiagnostic(
                'stream.revision-gap',
                {
                  threadId: id,
                  revision: previous?.revision,
                  baseRevision: m.update.baseRevision,
                },
                'WARN',
              );
              if (id === this.selected && !this.recovering.has(id)) {
                this.recovering.add(id);
                this.rpc('thread/read', { threadId: id })
                  .then(thread => this.deliver({ ...m, thread }))
                  .catch(() => {})
                  .finally(() => this.recovering.delete(id));
              }
            }
            return;
          }
        }
        if (m.type === 'command.result' || m.type === 'outcome.unknown') {
          const id = m.id.slice(m.id.indexOf(':') + 1),
            p = this.pending.get(id);
          if (p) {
            logDiagnostic('command.returned', {
              connectionId: this.connectionId,
              commandId: id,
              method: p.method,
              stage: m.type,
              errorCode: m.error ? diagnosticError(m.error) : undefined,
            });
            clearTimeout(p.timer);
            this.pending.delete(id);
            if (!m.error && p.method === 'thread/read' && m.result?.id)
              m.result = this.accept(m.result);
            m.error || m.type === 'outcome.unknown'
              ? p.reject(
                  Error(m.error ?? '执行结果未知，请刷新核对；不会自动重发'),
                )
              : p.resolve(m.result);
          }
        }
        if (['relay.received', 'bridge.accepted'].includes(m.type))
          logDiagnostic('command.stage', { commandId: m.id, stage: m.type });
        this.emit(m);
      } catch (e) {
        if (this.ws === socket) this.emit({ type: 'error', error: String(e) });
      }
    };
    socket.onclose = e => {
      if (this.ws !== socket) return;
      logDiagnostic(
        'connection.closed',
        { connectionId: this.connectionId, closeCode: e.code },
        'WARN',
      );
      if (e.code === 4003) {
        this.stopped = true;
        this.emit({ type: 'error', error: '设备授权无效，请重新配对' });
      }
      this.retire(socket);
    };
    socket.onerror = () => {
      if (this.ws !== socket) return;
      logDiagnostic(
        'connection.error',
        { connectionId: this.connectionId },
        'WARN',
      );
      this.emit({ type: 'error', error: '无法连接中转，请检查地址与网络' });
      this.retire(socket);
    };
  }
  rpc(method: string, params: any = {}): Promise<any> {
    if (!this.online || this.ws?.readyState !== 1)
      return Promise.reject(Error('电脑离线，请等待连接恢复'));
    const id =
      Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        logDiagnostic('command.timeout', { commandId: id, method }, 'WARN');
        this.pending.delete(id);
        reject(Error('等待超时，请刷新确认，避免重复发送'));
      }, 35000);
      this.pending.set(id, { resolve, reject, timer, method, params });
      logDiagnostic('command.sent', {
        connectionId: this.connectionId,
        commandId: id,
        method,
        threadId: params.threadId,
        epoch: this.epoch,
      });
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
    const socket = this.ws;
    this.ws = undefined;
    this.online = false;
    this.clearTransport();
    socket?.close();
    this.credentials = undefined;
    await Keychain.resetGenericPassword({ service: 'codex-remote' });
  }
}
export const client = new RemoteClient();
