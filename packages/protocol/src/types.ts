export type RemoteItem = {
  id: string;
  type: string;
  text: string;
  status?: string;
  image?: string;
  attachments?: {id:string;name:string}[];
};
export type RemoteThread = {
  id: string;
  title: string;
  cwd: string;
  model?: string;
  revision: number;
  activeTurnId?: string;
  lastTurnStatus?: string;
  lastTurnId?: string;
  items: RemoteItem[];
  requests: any[];
};
