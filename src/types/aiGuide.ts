export interface AiGuideMessage {
  role: "user" | "assistant";
  content: string;
  resourceIds?: number[];
  mode?: "deepseek" | "fallback";
}

export interface AiGuideResponse {
  success?: boolean;
  answer?: string;
  resourceIds?: number[];
  mode?: "deepseek" | "fallback";
  message?: string;
}

export interface AiGuideResult extends Omit<AiGuideResponse, "resourceIds"> {
  resourceIds?: number[];
}
