/**
 * @qa/email-adapters
 * Gmail API + Mailpit adapters behind a unified EmailAdapter interface.
 */


// ─── Types ────────────────────────────────────────────────────────────────────

export interface EmailMessage {
  id: string;
  to: string[];
  from: string;
  subject: string;
  body: {
    text: string | null;
    html: string | null;
  };
  receivedAt: string; // ISO timestamp
  headers: Record<string, string>;
}

export interface EmailAdapter {
  /**
   * Wait for an email matching the predicate to arrive, within timeoutMs.
   * Default timeout: 30 000 ms.
   * Rejects with an Error if the timeout elapses before a match is found.
   */
  waitForEmail(
    predicate: (msg: EmailMessage) => boolean,
    timeoutMs?: number
  ): Promise<EmailMessage>;

  /**
   * Return all emails currently in the inbox that satisfy the optional predicate.
   */
  getEmails(predicate?: (msg: EmailMessage) => boolean): Promise<EmailMessage[]>;

  /**
   * Delete / purge all emails (for test cleanup).
   */
  purgeAll(): Promise<void>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Mailpit adapter ─────────────────────────────────────────────────────────

interface MailpitAddress {
  Address: string;
  Name: string;
}

interface MailpitItem {
  ID: string;
  From: MailpitAddress;
  To: MailpitAddress[];
  Subject: string;
  Date: string;
  Snippet: string;
}

interface MailpitListResponse {
  total: number;
  unread: number;
  count: number;
  messages: MailpitItem[];
}

interface MailpitMessageDetail {
  ID: string;
  From: MailpitAddress;
  To: MailpitAddress[];
  Subject: string;
  Date: string;
  Text: string;
  HTML: string;
  Headers: Record<string, string[]>;
}

function mailpitItemToMessage(detail: MailpitMessageDetail): EmailMessage {
  const flatHeaders: Record<string, string> = {};
  for (const [key, values] of Object.entries(detail.Headers)) {
    flatHeaders[key] = Array.isArray(values) ? values.join(", ") : String(values);
  }

  return {
    id: detail.ID,
    to: detail.To.map((a) => a.Address),
    from: detail.From.Address,
    subject: detail.Subject,
    body: {
      text: detail.Text || null,
      html: detail.HTML || null,
    },
    receivedAt: new Date(detail.Date).toISOString(),
    headers: flatHeaders,
  };
}

export class MailpitAdapter implements EmailAdapter {
  private readonly apiUrl: string;

  constructor(opts: { apiUrl: string }) {
    this.apiUrl = opts.apiUrl.replace(/\/$/, "");
  }

  async getEmails(predicate?: (msg: EmailMessage) => boolean): Promise<EmailMessage[]> {
    const listRes = await fetch(`${this.apiUrl}/api/v1/messages`);
    if (!listRes.ok) {
      throw new Error(`Mailpit GET /api/v1/messages failed: ${listRes.status} ${listRes.statusText}`);
    }
    const listData = (await listRes.json()) as MailpitListResponse;
    const items = listData.messages ?? [];

    const messages: EmailMessage[] = [];
    for (const item of items) {
      const detailRes = await fetch(`${this.apiUrl}/api/v1/message/${item.ID}`);
      if (!detailRes.ok) continue;
      const detail = (await detailRes.json()) as MailpitMessageDetail;
      messages.push(mailpitItemToMessage(detail));
    }

    return predicate ? messages.filter(predicate) : messages;
  }

  async waitForEmail(
    predicate: (msg: EmailMessage) => boolean,
    timeoutMs = 30_000
  ): Promise<EmailMessage> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const messages = await this.getEmails(predicate);
      if (messages.length > 0) {
        return messages[0]!;
      }
      await sleep(500);
    }
    throw new Error(`waitForEmail: no matching email found within ${timeoutMs}ms`);
  }

  async purgeAll(): Promise<void> {
    const res = await fetch(`${this.apiUrl}/api/v1/messages`, { method: "DELETE" });
    if (!res.ok) {
      throw new Error(`Mailpit DELETE /api/v1/messages failed: ${res.status} ${res.statusText}`);
    }
  }
}

// ─── Gmail adapter ────────────────────────────────────────────────────────────

interface GmailOAuthConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  userEmail: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface GmailListResponse {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailMessagePart[];
}

interface GmailMessage {
  id: string;
  threadId: string;
  internalDate?: string;
  payload?: GmailMessagePart;
  snippet?: string;
}

function base64UrlDecode(data: string): string {
  // Gmail uses base64url encoding
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}

function extractBody(
  part: GmailMessagePart
): { text: string | null; html: string | null } {
  let text: string | null = null;
  let html: string | null = null;

  function walk(p: GmailMessagePart): void {
    const mime = (p.mimeType ?? "").toLowerCase();
    if (mime === "text/plain" && p.body?.data) {
      text = base64UrlDecode(p.body.data);
    } else if (mime === "text/html" && p.body?.data) {
      html = base64UrlDecode(p.body.data);
    }
    if (p.parts) {
      for (const child of p.parts) {
        walk(child);
      }
    }
  }

  walk(part);
  return { text, html };
}

function gmailMessageToEmailMessage(msg: GmailMessage): EmailMessage {
  const payload = msg.payload ?? {};
  const rawHeaders = payload.headers ?? [];

  const headers: Record<string, string> = {};
  for (const h of rawHeaders) {
    headers[h.name] = h.value;
  }

  const to = (headers["To"] ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  const from = headers["From"] ?? "";
  const subject = headers["Subject"] ?? "";
  const dateHeader = headers["Date"] ?? "";

  let receivedAt: string;
  try {
    receivedAt = dateHeader
      ? new Date(dateHeader).toISOString()
      : new Date(parseInt(msg.internalDate ?? "0", 10)).toISOString();
  } catch {
    receivedAt = new Date(parseInt(msg.internalDate ?? "0", 10)).toISOString();
  }

  const body = extractBody(payload as GmailMessagePart);

  return {
    id: msg.id,
    to,
    from,
    subject,
    body,
    receivedAt,
    headers,
  };
}

export class GmailAdapter implements EmailAdapter {
  private readonly config: GmailOAuthConfig;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(opts: GmailOAuthConfig) {
    this.config = opts;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 10_000) {
      return this.accessToken;
    }

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: this.config.refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Gmail token refresh failed: ${res.status} ${body}`);
    }

    const data = (await res.json()) as TokenResponse;
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;
    return this.accessToken;
  }

  private async gmailFetch(path: string, init?: RequestInit): Promise<Response> {
    const token = await this.getAccessToken();
    const url = `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(this.config.userEmail)}${path}`;
    return fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    } as RequestInit);
  }

  async getEmails(predicate?: (msg: EmailMessage) => boolean): Promise<EmailMessage[]> {
    // List message IDs
    const listRes = await this.gmailFetch("/messages?maxResults=100");
    if (!listRes.ok) {
      throw new Error(`Gmail list messages failed: ${listRes.status} ${listRes.statusText}`);
    }
    const listData = (await listRes.json()) as GmailListResponse;
    const ids = listData.messages ?? [];

    // Fetch full message details in parallel (batched to avoid rate limits)
    const messages: EmailMessage[] = [];
    for (const { id } of ids) {
      const msgRes = await this.gmailFetch(`/messages/${id}?format=full`);
      if (!msgRes.ok) continue;
      const msgData = (await msgRes.json()) as GmailMessage;
      messages.push(gmailMessageToEmailMessage(msgData));
    }

    return predicate ? messages.filter(predicate) : messages;
  }

  async waitForEmail(
    predicate: (msg: EmailMessage) => boolean,
    timeoutMs = 30_000
  ): Promise<EmailMessage> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const messages = await this.getEmails(predicate);
      if (messages.length > 0) {
        return messages[0]!;
      }
      await sleep(2_000);
    }
    throw new Error(`waitForEmail: no matching email found within ${timeoutMs}ms`);
  }

  async purgeAll(): Promise<void> {
    // Move all test-related messages (qa_/test_/e2e_ subjects) to trash
    const testSubjectQuery = "subject:qa_ OR subject:test_ OR subject:e2e_";
    const listRes = await this.gmailFetch(
      `/messages?q=${encodeURIComponent(testSubjectQuery)}&maxResults=500`
    );
    if (!listRes.ok) {
      throw new Error(`Gmail purgeAll list failed: ${listRes.status} ${listRes.statusText}`);
    }
    const listData = (await listRes.json()) as GmailListResponse;
    const ids = listData.messages ?? [];

    for (const { id } of ids) {
      await this.gmailFetch(`/messages/${id}/trash`, { method: "POST" });
    }
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export interface EmailAdapterConfig {
  emailAdapter: "mailpit" | "gmail";
  mailpitUrl?: string;
  gmail?: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    userEmail: string;
  };
}

/**
 * Creates the appropriate EmailAdapter from an aegis.config.json-shaped config object.
 * Uses MailpitAdapter when emailAdapter === "mailpit"; GmailAdapter otherwise.
 */
export function createEmailAdapter(config: EmailAdapterConfig): EmailAdapter {
  if (config.emailAdapter === "mailpit") {
    return new MailpitAdapter({
      apiUrl: config.mailpitUrl ?? "http://localhost:8025",
    });
  }

  if (!config.gmail) {
    throw new Error(
      'createEmailAdapter: emailAdapter is "gmail" but config.gmail is missing'
    );
  }

  return new GmailAdapter(config.gmail);
}
