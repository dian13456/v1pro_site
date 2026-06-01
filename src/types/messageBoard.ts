export interface BoardMessage {
  id: string;
  username: string;
  content: string;
  createdAt: number;
}

export interface MessageBoardState {
  messages: BoardMessage[];
  total: number;
}
