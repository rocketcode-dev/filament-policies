import type { HttpMethod, ResponseMode } from "filamentjs";

export interface RequestLoggingEndpointOptions {
  enabled?: boolean;
}

export interface AppMeta {
  requestLogging?: false | RequestLoggingEndpointOptions;
}

/** Request logging creates no request-local context state. */
export interface ContextMeta {}

export interface RequestLogRecord {
  requestId: string;
  method: HttpMethod;
  path: string;
  statusCode: number;
  mode: ResponseMode;
  latencyMs: number;
}

export type RequestLogFormatter = (
  record: Readonly<RequestLogRecord>,
) => string;

export type RequestLogSink = (
  record: Readonly<RequestLogRecord>,
  formattedLine: string,
) => void | Promise<void>;

export type RequestLoggingSkipReason =
  | "endpoint-disabled"
  | "missing-observation"
  | "missing-request-info"
  | "missing-method"
  | "missing-path";

export type RequestLogFailureStage = "diagnostic" | "formatter" | "sink";

export interface SetupOptions {
  sink?: RequestLogSink;
  formatter?: RequestLogFormatter;
  now?: () => number;
  onSkip?: (reason: RequestLoggingSkipReason) => void | Promise<void>;
  onError?: (
    error: unknown,
    stage: RequestLogFailureStage,
  ) => void | Promise<void>;
}
