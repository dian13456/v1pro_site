export function welcomeDismissKey(serial: string): string {
  return `jiadian_hub_welcome_dismissed_${serial}`;
}

export function softwarePromptDismissKey(serial: string): string {
  return `jiadian_hub_software_prompt_dismissed_${serial}`;
}

function readDismissed(key: string): boolean {
  if (!key) return true;
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function hasDismissedWelcome(serial: string): boolean {
  return readDismissed(welcomeDismissKey(serial));
}

export function dismissWelcome(serial: string): void {
  localStorage.setItem(welcomeDismissKey(serial), "1");
}

export function hasDismissedSoftwarePrompt(serial: string): boolean {
  return readDismissed(softwarePromptDismissKey(serial));
}

export function dismissSoftwarePrompt(serial: string): void {
  localStorage.setItem(softwarePromptDismissKey(serial), "1");
}
