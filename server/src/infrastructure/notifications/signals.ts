let wake: (() => void) | undefined;
export function setNotificationWake(handler: (() => void) | undefined) { wake = handler; }
export function wakeNotifications() { wake?.(); }
