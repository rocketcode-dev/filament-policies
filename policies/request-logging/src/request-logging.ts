import type {
  Application,
  ContextMeta as FilamentContextMeta,
  FrameworkMeta,
  Request,
  Response,
} from "filamentjs";

import type {
  AppMeta,
  ContextMeta,
  RequestLogFailureStage,
  RequestLogFormatter,
  RequestLogRecord,
  RequestLogSink,
  RequestLoggingSkipReason,
  SetupOptions,
} from "./types.js";

const registeredApplications = new WeakSet<object>();

function escapeLogField(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, (character) => {
    return `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
  });
}

export const formatRequestLog: RequestLogFormatter = (record): string => {
  const requestId = escapeLogField(record.requestId);
  const method = escapeLogField(record.method);
  const path = escapeLogField(record.path);
  return `[${requestId}] ${method} ${path} - ${record.statusCode} ${record.mode} ${record.latencyMs}ms`;
};

function defaultSink(
  _record: Readonly<RequestLogRecord>,
  formattedLine: string,
): void {
  console.log(formattedLine);
}

function defaultErrorReporter(): void {
  console.error("Request logging callback failed");
}

function assertOptionalFunction(name: string, value: unknown): void {
  if (value !== undefined && typeof value !== "function") {
    throw new TypeError(`${name} must be a function`);
  }
}

function endpointEnabled(meta: {
  readonly requestLogging?: AppMeta["requestLogging"] | undefined;
}): boolean {
  return (
    meta.requestLogging !== false && meta.requestLogging?.enabled !== false
  );
}

function calculateLatency(now: () => number, startTime: number): number {
  const value = now() - startTime;
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

async function safelyReportFailure(
  reporter: NonNullable<SetupOptions["onError"]>,
  error: unknown,
  stage: RequestLogFailureStage,
): Promise<void> {
  try {
    await reporter(error, stage);
  } catch {
    defaultErrorReporter();
  }
}

export function setup<
  A extends FrameworkMeta & AppMeta,
  C extends FilamentContextMeta & ContextMeta,
>(app: Application<A, C>, options: SetupOptions = {}): void {
  if (typeof app !== "object" || app === null) {
    throw new TypeError("app must be a Filament Application");
  }
  if (typeof app.onFinalize !== "function") {
    throw new TypeError("app must provide onFinalize()");
  }
  assertOptionalFunction("options.sink", options.sink);
  assertOptionalFunction("options.formatter", options.formatter);
  assertOptionalFunction("options.now", options.now);
  assertOptionalFunction("options.onSkip", options.onSkip);
  assertOptionalFunction("options.onError", options.onError);
  if (registeredApplications.has(app)) {
    throw new Error(
      "request-logging is already registered on this application",
    );
  }

  const sink: RequestLogSink = options.sink ?? defaultSink;
  const formatter = options.formatter ?? formatRequestLog;
  const now = options.now ?? Date.now;
  const onError = options.onError ?? defaultErrorReporter;
  const onSkip = options.onSkip;

  async function reportSkip(reason: RequestLoggingSkipReason): Promise<void> {
    if (!onSkip) return;
    try {
      await onSkip(reason);
    } catch (error) {
      await safelyReportFailure(onError, error, "diagnostic");
    }
  }

  async function requestLoggingFinalizer(
    req: Request<A, C>,
    res: Response,
  ): Promise<void> {
    if (!endpointEnabled(req.endpointMeta)) {
      await reportSkip("endpoint-disabled");
      return;
    }

    const observed = req.context.application?.observed;
    if (!observed) {
      await reportSkip("missing-observation");
      return;
    }
    if (!observed.requestInfo) {
      await reportSkip("missing-request-info");
      return;
    }
    if (!observed.requestInfo.method) {
      await reportSkip("missing-method");
      return;
    }
    if (!observed.requestInfo.path) {
      await reportSkip("missing-path");
      return;
    }

    const record = Object.freeze<RequestLogRecord>({
      requestId: observed.requestId,
      method: observed.requestInfo.method,
      path: observed.requestInfo.path,
      statusCode: res.statusCode,
      mode: res.streaming ? "streaming" : "buffered",
      latencyMs: calculateLatency(now, observed.startTime),
    });

    let line: string;
    try {
      line = formatter(record);
    } catch (error) {
      await safelyReportFailure(onError, error, "formatter");
      return;
    }

    try {
      await sink(record, line);
    } catch (error) {
      await safelyReportFailure(onError, error, "sink");
    }
  }

  app.onFinalize(requestLoggingFinalizer);
  registeredApplications.add(app);
}
