/** 网站昵称默认值：设备 SN 后十位（不足十位则取全部） */
export function displayUsernameFromSerial(serial: string): string {
  const trimmed = serial.trim();
  if (!trimmed) return "anonymous";
  if (trimmed.length <= 10) return trimmed;
  return trimmed.slice(-10);
}
