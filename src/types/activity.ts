export interface LotteryActivity {
  id: string;
  title: string;
  description: string;
  rule: string;
  startTime: number;
  endTime: number;
  status: string;
  prizeTitle: string;
  prizeDescription: string;
  prizeImage?: string;
  drawHour: number;
  drawMinute: number;
  winnersPerDraw: number;
  shippingDays: number;
  participantCount: number;
  nextDrawAt: number;
  registrationOpen?: boolean;
  registrationMessage?: string;
  hasJoined?: boolean;
  joinedSn?: string;
  isWinner?: boolean;
  winnerId?: string;
  contactStatus?: string;
}

export interface LotteryJoinResult {
  success: boolean;
  message: string;
  joinId?: string;
  drawPeriod?: string;
}

export interface PrizeInfoStatus {
  isWinner: boolean;
  winnerId?: string;
  activityId?: string;
  activityTitle?: string;
  contactStatus?: string;
  shippingStatus?: string;
  hasSubmitted?: boolean;
  shippingDays?: number;
}

export interface PrizeInfoSubmitResult {
  success: boolean;
  message: string;
  shippingDays?: number;
}

export interface ActivityAdminItem extends LotteryActivity {
  createdAt?: number;
  updatedAt?: number;
}

export interface ActivityJoinRecord {
  id: string;
  activityId: string;
  sn: string;
  userSerial: string;
  userIp: string;
  joinTime: number;
  drawPeriod: string;
  status: string;
}

export interface ActivityWinnerRecord {
  id: string;
  activityId: string;
  sn: string;
  userSerial: string;
  winnerTime: number;
  contactStatus: string;
  shippingStatus: string;
  drawPeriod: string;
}

export interface PublicWinnerRecord {
  drawPeriod: string;
  displayName: string;
  snMasked: string;
  prizeTitle: string;
  winnerTime: number;
}

export interface PublicWinnersView {
  activityId: string;
  activityTitle: string;
  prizeTitle: string;
  winners: PublicWinnerRecord[];
}

export interface WinnerContactInfo {
  name: string;
  phone: string;
  wechat: string;
  qq: string;
  province: string;
  city: string;
  address: string;
}
