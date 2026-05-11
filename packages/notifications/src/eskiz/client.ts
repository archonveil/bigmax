/**
 * Production-клиент Eskiz.uz. Делает login для получения JWT (~30 дней)
 * и отправляет SMS через POST /api/message/sms/send.
 *
 * Токен кешируется в памяти процесса; при 401 — перелогинится.
 */

import type { EskizClient, SendSmsInput, SendSmsResult } from "./types";

export interface EskizClientConfig {
  email: string;
  password: string;
  /** From/sender name; по умолчанию "BIGMAX". */
  sender?: string;
  /** Базовый URL API; по умолчанию https://notify.eskiz.uz. */
  baseUrl?: string;
}

export function createEskizClient(config: EskizClientConfig): EskizClient {
  const baseUrl = config.baseUrl ?? "https://notify.eskiz.uz";
  const sender = config.sender ?? "BIGMAX";

  let token: string | null = null;

  async function login(): Promise<string> {
    const form = new URLSearchParams();
    form.set("email", config.email);
    form.set("password", config.password);
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    if (!res.ok) {
      throw new Error(`eskiz login failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { data?: { token?: string } };
    const fresh = data.data?.token;
    if (!fresh) throw new Error("eskiz login: no token in response");
    token = fresh;
    return fresh;
  }

  async function getToken(): Promise<string> {
    if (token) return token;
    return login();
  }

  return {
    async sendSms(input: SendSmsInput): Promise<SendSmsResult> {
      const doRequest = async (authToken: string): Promise<Response> => {
        const form = new URLSearchParams();
        form.set("mobile_phone", input.phone.replace(/^\+/, ""));
        form.set("message", input.text);
        form.set("from", sender);
        return fetch(`${baseUrl}/api/message/sms/send`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${authToken}`,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: form.toString(),
        });
      };

      let res = await doRequest(await getToken());
      if (res.status === 401) {
        token = null;
        res = await doRequest(await getToken());
      }
      if (!res.ok) {
        throw new Error(`eskiz sendSms failed: ${res.status} ${await res.text()}`);
      }
      const body = (await res.json()) as { id?: string | number; status?: string };
      return {
        id: String(body.id ?? ""),
        status: "waiting",
      };
    },
  };
}
