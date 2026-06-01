export interface AiGuideMessage {
  role: "user" | "assistant";
  content: string;
  resourceIds?: number[];
  mode?: "deepseek" | "fallback";
}

export interface AiGuideResponse {
  success?: boolean;
  answer?: string;
  resourceIds?: Array<number | string>;
  mode?: "deepseek" | "fallback";
  message?: string;
}
