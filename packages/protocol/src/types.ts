export type RemoteItem = {
  id: string;
  type: string;
  text: string;
  status?: string;
  image?: string;
};
export type RemoteThread = {
  id: string;
  title: string;
  cwd: string;
  model?: string;
  revision: number;
  activeTurnId?: string;
  lastTurnStatus?: string;
  items: RemoteItem[];
  requests: any[];
};
