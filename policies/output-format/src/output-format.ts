import type {
  Application,
  ContextMeta as FilamentContext,
  FrameworkMeta,
  Request,
  Response,
} from "filamentjs";
import { stringify } from "yaml";
import type {
  AppMeta,
  ContextMeta,
  Format,
  OutputFormatEndpointOptions,
  SetupOptions,
} from "./types.js";

const installed = new WeakSet<object>();
const TYPES: Readonly<Record<Format, readonly string[]>> = {
  json: ["application/json"],
  yaml: ["application/yaml", "text/yaml"],
  jsonp: ["application/javascript", "text/javascript"],
};

interface Range {
  type: string;
  subtype: string;
  q: number;
  order: number;
  compatible: boolean;
}
const TOKEN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
function parseAccept(value: string): Range[] {
  return value
    .split(",")
    .map((part, order) => {
      const [media = "", ...parameters] = part.trim().split(";");
      const slash = media.indexOf("/");
      if (slash < 1) return undefined;
      const type = media.slice(0, slash).trim().toLowerCase();
      const subtype = media.slice(slash + 1).trim().toLowerCase();
      if (
        !(type === "*" || TOKEN.test(type)) ||
        !(subtype === "*" || TOKEN.test(subtype)) ||
        (type === "*" && subtype !== "*")
      )
        return undefined;
      let q = 1,
        sawQuality = false,
        compatible = true;
      for (const raw of parameters) {
        const parameter = raw.trim();
        const field = /^([^=\s]+)\s*=\s*("[^"]*"|[^\s]+)$/.exec(parameter);
        if (!field || !TOKEN.test(field[1]!)) return undefined;
        const name = field[1]!.toLowerCase();
        const rawValue = field[2]!;
        const fieldValue = rawValue.startsWith('"')
          ? rawValue.slice(1, -1)
          : rawValue;
        if (name === "q") {
          if (
            sawQuality ||
            !/^(?:0(?:\.\d{0,3})?|\.\d{1,3}|1(?:\.0{0,3})?)$/.test(
              fieldValue,
            )
          )
            return undefined;
          sawQuality = true;
          q = Number(fieldValue);
        } else if (!sawQuality) {
          // Offered representations carry only UTF-8 charset. Parameters after
          // q are Accept extensions and do not constrain media matching.
          if (name !== "charset" || fieldValue.toLowerCase() !== "utf-8")
            compatible = false;
        }
      }
      return {
        type,
        subtype,
        q,
        order,
        compatible,
      };
    })
    .filter((item): item is Range => item !== undefined);
}
function score(
  media: string,
  ranges: readonly Range[],
): readonly [number, number, number] {
  const [type, subtype] = media.split("/") as [string, string];
  let best: readonly [number, number, number] = [-1, -1, -Infinity];
  for (const range of ranges) {
    if (!range.compatible) continue;
    if (range.type !== "*" && range.type !== type) continue;
    if (
      range.subtype !== "*" &&
      range.subtype !== subtype &&
      !(
        range.subtype.startsWith("*+") &&
        subtype.endsWith(range.subtype.slice(1))
      )
    )
      continue;
    const specificity =
      (range.type === "*" ? 0 : 1) + (range.subtype === "*" ? 0 : 1);
    if (
      specificity > best[1] ||
      (specificity === best[1] && range.order < -best[2])
    )
      best = [range.q, specificity, -range.order];
  }
  return best;
}
export function negotiate(
  accept: string | undefined,
  allowed: readonly Format[],
  fallback: Format,
): Format | undefined {
  if (accept === undefined || accept.trim() === "")
    return allowed.includes(fallback) ? fallback : allowed[0];
  const ranges = parseAccept(accept);
  let selected: Format | undefined;
  let selectedScore: readonly [number, number, number] = [-1, -1, -Infinity];
  for (const format of allowed)
    for (const media of TYPES[format]) {
      const candidate = score(media, ranges);
      if (
        candidate[0] > 0 &&
        (candidate[0] > selectedScore[0] ||
          (candidate[0] === selectedScore[0] &&
            candidate[1] > selectedScore[1]) ||
          (candidate[0] === selectedScore[0] &&
            candidate[1] === selectedScore[1] &&
            candidate[2] > selectedScore[2]))
      ) {
        selected = format;
        selectedScore = candidate;
      }
    }
  return selected;
}
function oneHeader(req: Request, name: string): string | undefined {
  const value = req.headers.get(name);
  return Array.isArray(value) ? value.join(",") : (value ?? undefined);
}
function vary(res: Response): void {
  const current = res.headers.get("Vary");
  const values = (Array.isArray(current) ? current.join(",") : (current ?? ""))
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  if (!values.some((v) => v.toLowerCase() === "accept")) values.push("Accept");
  res.headers.set("Vary", values.join(", "));
}
function validateFormats(values: readonly Format[]): void {
  if (
    values.length === 0 ||
    new Set(values).size !== values.length ||
    values.some((v) => !(v in TYPES))
  )
    throw new TypeError("allowed must contain unique supported formats");
}
function endpoint(
  value: AppMeta["outputFormat"],
  defaults: Required<SetupOptions>,
): false | Required<OutputFormatEndpointOptions> {
  if (value === false || value?.enabled === false) return false;
  return {
    enabled: true,
    allowed: value?.allowed ?? defaults.allowed,
    default: value?.default ?? defaults.default,
    jsonpCallbackQuery:
      value?.jsonpCallbackQuery ?? defaults.jsonpCallbackQuery,
  };
}
export function setup<
  A extends FrameworkMeta & AppMeta,
  C extends FilamentContext & ContextMeta,
>(app: Application<A, C>, options: SetupOptions = {}): void {
  if (installed.has(app))
    throw new Error("output-format is already installed on this application");
  const defaults: Required<SetupOptions> = {
    allowed: options.allowed ?? ["json", "yaml"],
    default: options.default ?? "json",
    jsonpCallbackQuery: options.jsonpCallbackQuery ?? "callback",
  };
  validateFormats(defaults.allowed);
  if (!defaults.allowed.includes(defaults.default))
    throw new TypeError("default must be allowed");
  async function outputFormatNegotiation(
    req: Request<A, C>,
    res: Response,
  ): Promise<void> {
    const config = endpoint(req.endpointMeta.outputFormat, defaults);
    if (config === false) return;
    validateFormats(config.allowed);
    if (!config.allowed.includes(config.default))
      throw new TypeError("endpoint output format default must be allowed");
    const format = negotiate(
      oneHeader(req, "accept"),
      config.allowed,
      config.default,
    );
    if (format === undefined) {
      res.statusCode = 406;
      await res.send("Not Acceptable");
      return;
    }
    let callback: string | undefined;
    if (format === "jsonp") {
      if (req.method !== "GET") {
        res.statusCode = 406;
        await res.send("Not Acceptable");
        return;
      }
      const raw = req.query[config.jsonpCallbackQuery];
      callback = Array.isArray(raw) ? undefined : raw;
      if (
        callback === undefined ||
        callback.length > 128 ||
        !/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(
          callback,
        )
      ) {
        res.statusCode = 400;
        await res.send("Invalid JSONP callback");
        return;
      }
    }
    req.context.outputFormat = Object.freeze({
      format,
      ...(callback === undefined ? {} : { callback }),
    });
  }
  async function outputFormatTransformer(
    req: Request<A, C>,
    res: Response,
  ): Promise<void> {
    const selection = req.context.outputFormat;
    if (
      selection === undefined ||
      req.method === "HEAD" ||
      res.statusCode < 200 ||
      res.statusCode === 204 ||
      res.statusCode === 304
    )
      return;
    vary(res);
    const contentType = res.headers.get("Content-Type");
    const type = Array.isArray(contentType) ? contentType[0] : contentType;
    if (
      typeof type !== "string" ||
      !/(^application\/json\b|\+json\b)/i.test(type)
    )
      return;
    const body = res.body;
    if (body === null || body.length === 0) return;
    const value: unknown = JSON.parse(body.toString("utf8"));
    if (selection.format === "yaml") {
      res.headers.set("Content-Type", "application/yaml; charset=utf-8");
      res.body = stringify(value, {
        aliasDuplicateObjects: false,
        lineWidth: 0,
        sortMapEntries: true,
      });
    } else if (selection.format === "jsonp") {
      const json = JSON.stringify(value).replace(/[<\u2028\u2029]/g, (c) =>
        c === "<" ? "\\u003c" : c === "\u2028" ? "\\u2028" : "\\u2029",
      );
      res.headers.set("Content-Type", "application/javascript; charset=utf-8");
      res.headers.set("X-Content-Type-Options", "nosniff");
      res.body = `${selection.callback}(${json});\n`;
    } else res.headers.set("Content-Type", "application/json; charset=utf-8");
  }
  app.use(outputFormatNegotiation);
  app.onTransform(outputFormatTransformer);
  installed.add(app);
}
