export type ActivityStatus = "ongoing" | "upcoming" | "ended";

export type ActivityCategory = "reward" | "feature" | "notice";

export interface ActivityItem {
  id: string;
  title: string;
  summary: string;
  body: string;
  status: ActivityStatus;
  category: ActivityCategory;
  startDate: string;
  endDate?: string;
  featured?: boolean;
  linkTo?: string;
  linkLabel?: string;
}

export const ACTIVITY_STATUS_LABELS: Record<ActivityStatus, string> = {
  ongoing: "进行中",
  upcoming: "即将开始",
  ended: "已结束",
};

export const ACTIVITY_CATEGORY_LABELS: Record<ActivityCategory, string> = {
  reward: "积分福利",
  feature: "功能上新",
  notice: "平台公告",
};

export const ACTIVITY_CENTER_INTRO =
  "查看佳点 HUB 最新活动、积分福利与设备抽奖。参与 SN 码抽奖、积分兑换或功能体验，获取更多权益。";

export const ACTIVITIES: ActivityItem[] = [
  {
    id: "promo-choice-2026",
    title: "新上福利活动（二选一）",
    summary: "CNC 复购加送注塑 V1PRO，或参与视频点赞免单，只能选一个。各 260 份报满即止。",
    body: "活动一：原有 CNC 用户，复购注塑 V1PRO，凭订单号加送一个注塑 V1PRO。资料填写 CNC 订单号（直购用户发支付截图）、订单截图、注塑 V1PRO 颜色备注和收货地址，审核通过后安排加送发货。活动二：视频点赞免单，需提交订单号、订单截图、视频链接与收款码。两个活动只能二选一参与，各限 260 份，报满即止。",
    status: "ongoing",
    category: "reward",
    startDate: "2026-08-01",
    endDate: "2026-12-31",
    featured: true,
    linkTo: "/activities/promo",
    linkLabel: "立即报名",
  },
  {
    id: "device-lottery",
    title: "设备用户专属抽奖",
    summary: "每天 0:00 开放报名，晚上 7:00 自动开奖。",
    body: "购买 V1PRO 设备即可使用 SN 编号报名参与抽奖。每天 0:00 报名信息刷新，前一天报名记录清零；每天晚上 7:00 自动开奖。每个 SN、同一公网 IP 每天仅可报名一次，一个 SN 仅可获得一次中奖资格。本期奖品为打印喵喵V1.0板子。中奖后请填写收货地址与 QQ 号，我们将安排发货。",
    status: "ongoing",
    category: "reward",
    linkTo: "/activities/lottery",
    linkLabel: "立即参与抽奖",
  },
  {
    id: "like-reward",
    title: "点赞得积分",
    summary: "点赞双方均可获得积分：上传者 +1，点赞者 +0.5；每个 SN 每天前 10 次点赞有效。",
    body: "在素材中心浏览并点赞他人作品时：每个 SN 每天前 10 次点赞计入积分，上传者获得 1 积分、点赞者获得 0.5 积分；第 11 次起仍会增加点赞数量，但双方不再获得积分。取消点赞不扣回，再次点赞不重复发放。素材被他人有效下载时，上传者再获得 0.5 积分，每日最多 20 积分（同一下载者对同一素材每天仅计 1 次，自下载不计）。积分可在积分商城兑换 V1PRO CNC 喵喵壳子 77 帧兑换码等权益。不能给自己的素材点赞或下载得分。",
    status: "ongoing",
    category: "reward",
    startDate: "2026-01-01",
    linkTo: "/shop",
    linkLabel: "前往积分商城",
  },
  {
    id: "share-upload",
    title: "分享你的作品",
    summary: "上传 GIF、视频或 AI 生图，分享给更多佳点用户。",
    body: "通过「分享」页面上传 GIF 动图、视频素材，或将 AI 生图结果分享到素材库。优质内容经复核通过后将展示在素材中心，供其他用户浏览、点赞与下载。",
    status: "ongoing",
    category: "feature",
    startDate: "2026-02-01",
    linkTo: "/share",
    linkLabel: "去分享",
  },
  {
    id: "ai-image",
    title: "AI 生图体验",
    summary: "输入提示词，一键生成适合 V1PRO 设备的图片素材。",
    body: "在「AI 生图」页面描述你想要的画面风格、角色与场景，系统会生成图片并支持预览、下载与分享。生成内容需经人工复核后才会公开展示。",
    status: "ongoing",
    category: "feature",
    startDate: "2026-03-01",
    linkTo: "/ai-image",
    linkLabel: "开始生图",
  },
  {
    id: "ai-guide",
    title: "AI 助手上线",
    summary: "用自然语言搜索素材，快速找到想要的 GIF 与视频。",
    body: "「AI 助手」支持用口语化描述查找素材，例如「适合横屏的可爱 GIF」「月薪喵专栏有什么」。助手会从素材库中推荐匹配内容，并可直接预览与传输到设备。",
    status: "ongoing",
    category: "feature",
    startDate: "2026-04-01",
    linkTo: "/guide",
    linkLabel: "打开 AI 助手",
  },
  {
    id: "shop-redeem",
    title: "积分商城兑换",
    summary: "用积分兑换 V1PRO CNC 喵喵壳子 77 帧兑换码。",
    body: "在积分商城查看当前积分余额与可兑换商品。兑换成功后，兑换码仅在本页展示一次，请截图或复制保存。更多商品将陆续上架。",
    status: "ongoing",
    category: "reward",
    startDate: "2026-01-15",
    linkTo: "/shop",
    linkLabel: "查看商城",
  },
  {
    id: "welcome-hub",
    title: "佳点 HUB 资源中心",
    summary: "WebUSB 设备认证后，即可访问素材、软件与固件下载。",
    body: "佳点 HUB 面向 V1PRO 授权用户提供素材浏览、收藏、点赞、传输与分享服务。请使用合法购买的授权设备完成 WebUSB 认证后访问本站。",
    status: "ongoing",
    category: "notice",
    startDate: "2025-12-01",
    linkTo: "/",
    linkLabel: "进入素材中心",
  },
];
