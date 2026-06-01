export interface WelcomePayload {
  success?: boolean;
  message?: string;
  username?: string;
  city?: string;
  region?: string;
  localTime?: string;
  temperature?: number;
  weatherText?: string;
}
