import { SpanStatusCode, trace, type Attributes } from "@opentelemetry/api";

/**
 * OpenTelemetry-compatible boundary. With no SDK registered (Milestone 1) these spans are no-ops;
 * registering an OTel SDK/exporter later requires no call-site changes. Never put contact details
 * or message content in attributes.
 */
const tracer = trace.getTracer("agentic-operations-crm");

export async function span<T>(name: string, attributes: Attributes, fn: () => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (s) => {
    try {
      return await fn();
    } catch (e) {
      s.recordException(e as Error);
      s.setStatus({ code: SpanStatusCode.ERROR });
      throw e;
    } finally {
      s.end();
    }
  });
}
