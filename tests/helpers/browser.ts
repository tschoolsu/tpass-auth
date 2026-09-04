// 一個很小的「瀏覽器」：共用同一個 cookie jar，可以開多個分頁。
//
// 這是重現「多人同時登入出現 Invalid OAuth state」的關鍵工具——那個問題的本質是
// **同一個瀏覽器的多條登入流程共用同一組 cookie**，所以測試必須能表達「同一個 jar、
// 兩條並行的流程」，用兩個獨立的 fetch 是測不出來的。
import { APP_URL } from "./env";

interface StoredCookie {
  value: string;
  maxAge?: number;
  setAt: number;
}

export class Browser {
  private jar = new Map<string, StoredCookie>();

  /** 目前 jar 裡所有還沒過期的 cookie，組成 Cookie header。 */
  cookieHeader(): string {
    const now = Date.now();
    const parts: string[] = [];
    for (const [name, c] of this.jar) {
      if (c.maxAge !== undefined && now - c.setAt > c.maxAge * 1000) continue;
      if (c.value === "") continue; // 已被刪除
      parts.push(`${name}=${c.value}`);
    }
    return parts.join("; ");
  }

  get(name: string): string | undefined {
    const c = this.jar.get(name);
    return c && c.value !== "" ? c.value : undefined;
  }

  /** 直接塞一顆 cookie（測試要偽造登入態時用）。 */
  set(name: string, value: string): void {
    this.jar.set(name, { value, setAt: Date.now() });
  }

  /** 讓某顆 cookie 看起來像是很久以前設的，用來測 maxAge 過期而不必真的等。 */
  ageCookie(name: string, seconds: number): void {
    const c = this.jar.get(name);
    if (c) c.setAt = c.setAt - seconds * 1000;
  }

  names(): string[] {
    return [...this.jar.entries()].filter(([, c]) => c.value !== "").map(([n]) => n);
  }

  private absorb(res: Response): void {
    // undici 的 getSetCookie() 會把多顆 Set-Cookie 拆開，不用自己切逗號。
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = raw.split(";");
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const maxAgeAttr = attrs
        .map((a) => a.trim().toLowerCase())
        .find((a) => a.startsWith("max-age="));
      const maxAge = maxAgeAttr ? Number(maxAgeAttr.slice("max-age=".length)) : undefined;
      this.jar.set(name, { value, maxAge, setAt: Date.now() });
    }
  }

  /** 發一個請求，自動帶上 jar 裡的 cookie 並吸收回應的 Set-Cookie。預設不跟隨轉址。 */
  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    const cookie = this.cookieHeader();
    if (cookie) headers.set("Cookie", cookie);
    const res = await fetch(path.startsWith("http") ? path : `${APP_URL}${path}`, {
      ...init,
      headers,
      redirect: init.redirect ?? "manual",
    });
    this.absorb(res);
    return res;
  }
}
