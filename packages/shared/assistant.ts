/**
 * Bridge to the OpenClaw personal assistant — reminders and notifications
 * ride its channels (Telegram + Slack) so everything reaches the operator
 * in one place. Uses the ASSISTANT service binding when deployed
 * (same-account workers.dev fetches 404); fire-and-forget, never throws.
 */
const ASSISTANT_API =
  (globalThis as any).process?.env?.ASSISTANT_API_URL ||
  "https://monster-agent-backend.joelobafemii.workers.dev";

export async function notifyAssistant(title: string, message: string): Promise<void> {
  try {
    const svc = (globalThis as any).__ASSISTANT;
    const doFetch = svc ? svc.fetch.bind(svc) : fetch;
    await doFetch(`${ASSISTANT_API}/api/notify/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, message }),
    });
  } catch {
    // notifications must never break the pipeline
  }
}
