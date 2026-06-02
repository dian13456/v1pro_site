export interface BoardMessage {
  id: string;
  username: string;
  content: string;
  createdAt: number;
  serial?: string;
}

export interface MessageBoardState {
  messages: BoardMessage[];
  total: number;
}
