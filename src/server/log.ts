import pino from "pino";

/**
 * Structured logger with redaction. Contact details, message bodies, credentials and cookies are
 * never written to logs. Pass correlationId on every log line that relates to a request or run.
 */
export const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: process.env.CRM_SERVICE_NAME ?? "crm" },
  redact: {
    paths: [
      "password", "*.password", "token", "*.token", "secret", "*.secret",
      "email", "*.email", "phone", "*.phone", "body", "*.body", "toAddress", "*.toAddress",
      "headers.cookie", "headers.authorization", "*.headers.cookie", "*.headers.authorization",
      "fields", "*.fields",
    ],
    censor: "[redacted]",
  },
});
