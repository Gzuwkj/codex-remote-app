import {WebSocket} from 'ws';

/** Detect a half-open relay link even when no desktop task is producing events. */
export class RelayHeartbeat {
  private next?: ReturnType<typeof setTimeout>;
  private deadline?: ReturnType<typeof setTimeout>;
  private pending?: string;
  private sentAt=0;
  private sequence=0;
  constructor(private socket:WebSocket,private report:(event:string,details:Record<string,unknown>)=>void,
    private intervalMs=15000,private timeoutMs=8000){}
  start(){
    this.stop();
    this.socket.on('pong',this.pong);this.socket.once('close',this.closed);
    this.probe();
  }
  stop(){
    if(this.next)clearTimeout(this.next);if(this.deadline)clearTimeout(this.deadline);
    this.next=this.deadline=undefined;this.pending=undefined;
    this.socket.off('pong',this.pong);this.socket.off('close',this.closed);
  }
  private closed=()=>this.stop();
  private pong=(data:Buffer)=>{
    if(!this.pending||data.toString()!==this.pending)return;
    if(this.deadline)clearTimeout(this.deadline);this.deadline=undefined;this.pending=undefined;
    if(this.sequence===1||this.sequence%4===0)this.report('relay.heartbeat-ok',{seq:this.sequence,latencyMs:Date.now()-this.sentAt});
    this.next=setTimeout(()=>this.probe(),this.intervalMs);this.next.unref?.();
  };
  private probe(){
    if(this.socket.readyState!==WebSocket.OPEN){this.stop();return;}
    this.sentAt=Date.now();this.pending=`remoteapp:${this.sentAt}:${++this.sequence}`;
    this.deadline=setTimeout(()=>this.expire('pong-timeout'),this.timeoutMs);this.deadline.unref?.();
    try{this.socket.ping(this.pending);}catch{this.expire('ping-failed');}
  }
  private expire(reason:string){
    const elapsedMs=Date.now()-this.sentAt;this.stop();
    this.report('relay.heartbeat-expired',{reason,elapsedMs});
    // close() can itself wait on a dead TCP connection. terminate() makes reconnect immediate.
    this.socket.terminate();
  }
}
