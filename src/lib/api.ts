// All deployment modes use same-origin /api routes. Never embed server secrets.
export async function fetchJson(path: string, options: RequestInit = {}) {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      ...options,
      signal: options.signal ?? AbortSignal.timeout(60000),
    });
  } catch (error) {
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name))
      throw Error("请求超时，请稍后重试");
    throw Error("无法连接服务，请检查网络后重试");
  }
  if (!/^application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/i.test(response.headers.get("content-type") || ""))
    throw Error("服务返回了非 JSON 页面，可能需要安全验证；请刷新页面完成验证后重试，或联系管理员检查 API 路由。");
  let data;
  try {
    data = await response.json();
  } catch (error) {
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name))
      throw Error("请求超时，请稍后重试");
    throw Error("服务返回的数据格式不正确，请稍后重试");
  }
  if (!response.ok) {
    const defaults: Record<number, string> = {
      401: "AI 访问口令错误或未填写",
      403: "请求被安全策略拦截，请完成验证后重试",
      429: "请求过于频繁，请稍后重试",
      504: "请求超时，请稍后重试",
    };
    throw Error(typeof data?.error === "string" ? data.error : defaults[response.status] || "服务请求失败，请稍后重试");
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw Error("服务返回的数据格式不正确，请稍后重试");
  return data;
}
