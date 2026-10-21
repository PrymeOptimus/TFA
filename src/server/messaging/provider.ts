/**
 * Messaging provider adapter contract. Real adapters (Twilio SMS, an email provider) arrive in
 * Milestone 2 and must implement the same contract, including honest idempotency reporting.
 */
export interface SendRequest {
  tenantId: string;
  /** Stable per logical send. Providers that support idempotency must dedupe on it. */
  idempotencyKey: string;
  channel: "sms" | "email";
  to: string;
  subject?: string;
  body: string;
}

export type SendResult =
  | { ok: true; providerMessageId: string; status: "provider_accepted"; replayed: boolean }
  | { ok: false; retryable: boolean; error: string };

export interface MessagingProvider {
  /** Provider identifier stored with each message. */
  readonly name: string;
  /** True for local simulation adapters. Simulated sends never reach a real recipient. */
  readonly simulated: boolean;
  /**
   * True when re-sending with the same idempotency key cannot create a second real message. If
   * false, an interrupted dispatch is marked "unknown" and routed to human review, never resent.
   */
  readonly supportsIdempotentRetry: boolean;
  send(req: SendRequest): Promise<SendResult>;
}
