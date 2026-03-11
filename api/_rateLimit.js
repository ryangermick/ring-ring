// api/_rateLimit.js
const windows = new Map();

export function rateLimit(userId, { maxRequests = 20, windowMs = 60000 } = {}) {
  const now = Date.now();
  if (!windows.has(userId)) {
    windows.set(userId, { count: 1, start: now });
    return { allowed: true, remaining: maxRequests - 1 };
  }

  const window = windows.get(userId);
  if (now - window.start > windowMs) {
    windows.set(userId, { count: 1, start: now });
    return { allowed: true, remaining: maxRequests - 1 };
  }

  window.count++;
  if (window.count > maxRequests) {
    return { allowed: false, remaining: 0, retryAfter: Math.ceil((window.start + windowMs - now) / 1000) };
  }
  return { allowed: true, remaining: maxRequests - window.count };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of windows) {
    if (now - val.start > 120000) windows.delete(key);
  }
}, 60000);
