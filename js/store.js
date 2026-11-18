// Tiny shared store for files handed to the Linux guest (used by Downloads, Files, Editor).
const listeners = new Set();

export const sharedFiles = [];

export function addSharedFile(entry) {
  sharedFiles.unshift({ at: Date.now(), ...entry });
  if (sharedFiles.length > 40) sharedFiles.pop();
  for (const fn of listeners) fn(sharedFiles);
}

export function onSharedChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function formatBytes(n) {
  if (!n && n !== 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}
