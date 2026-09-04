const SUPPORTED_WRITE_TOOLS = new Set([
  "gmail_create_draft",
  "gmail_send",
  "calendar_create_event",
]);
const HEADER_BREAK = /[\r\n]/;
const EMAIL =
  /^(?=.{3,254}$)[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?$/i;
const MAX_RECIPIENTS = 25;
const MAX_RECIPIENT_FIELD_LENGTH = 6_500;

export class GoogleWriteValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "GoogleWriteValidationError";
  }
}

function requireRecord(args) {
  if (args === null || Array.isArray(args) || typeof args !== "object") {
    throw new GoogleWriteValidationError("Google action arguments must be an object.");
  }
  return args;
}

function requiredString(args, key, label, maxLength, { trim = false, header = false } = {}) {
  const value = args[key];
  if (typeof value !== "string") {
    throw new GoogleWriteValidationError(`${label} is required.`);
  }
  if (header && HEADER_BREAK.test(value)) {
    throw new GoogleWriteValidationError(`${label} must be a single line.`);
  }
  const normalized = trim ? value.trim() : value;
  if (!normalized.trim() || normalized.length > maxLength) {
    throw new GoogleWriteValidationError(
      `${label} is required and must be at most ${maxLength.toLocaleString("en-US")} characters.`,
    );
  }
  return normalized;
}

function optionalString(args, key, label, maxLength) {
  const value = args[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new GoogleWriteValidationError(
      `${label} must be at most ${maxLength.toLocaleString("en-US")} characters.`,
    );
  }
  return value;
}

function recipientList(value, label, required = false) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new GoogleWriteValidationError(`${label} requires at least one address.`);
    return [];
  }
  if (
    typeof value !== "string" ||
    value.length > MAX_RECIPIENT_FIELD_LENGTH ||
    HEADER_BREAK.test(value)
  ) {
    throw new GoogleWriteValidationError(`${label} contains an invalid email address.`);
  }
  const recipients = value.split(",").map((address) => address.trim());
  if (
    recipients.length > MAX_RECIPIENTS ||
    recipients.some((address) => !address || address.length > 254 || !EMAIL.test(address))
  ) {
    throw new GoogleWriteValidationError(`${label} contains an invalid email address.`);
  }
  return recipients;
}

function attendeeList(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_RECIPIENTS) {
    throw new GoogleWriteValidationError(
      `Attendees must contain no more than ${MAX_RECIPIENTS} valid email addresses.`,
    );
  }
  const attendees = value.map((address) => {
    if (typeof address !== "string") return "";
    return address.trim();
  });
  if (
    attendees.some(
      (address) =>
        !address || address.length > 254 || HEADER_BREAK.test(address) || !EMAIL.test(address),
    )
  ) {
    throw new GoogleWriteValidationError("Attendees contains an invalid email address.");
  }
  return attendees;
}

function timezone(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > 100 || HEADER_BREAK.test(value)) {
    throw new GoogleWriteValidationError("Event timezone is invalid.");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
  } catch {
    throw new GoogleWriteValidationError("Event timezone is invalid.");
  }
  return value;
}

function rfc3339Date(value, label) {
  if (typeof value !== "string" || value.length > 40) {
    throw new GoogleWriteValidationError(`${label} must be an RFC 3339 date-time.`);
  }
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (!match) {
    throw new GoogleWriteValidationError(`${label} must include an explicit timezone.`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const offsetHours = Number(match[8] ?? 0);
  const offsetMinutes = Number(match[9] ?? 0);
  const daysInMonth =
    month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0;
  if (
    year === 0 ||
    day < 1 ||
    day > daysInMonth ||
    offsetHours > 14 ||
    offsetMinutes > 59 ||
    (offsetHours === 14 && offsetMinutes !== 0)
  ) {
    throw new GoogleWriteValidationError(`${label} is not a valid RFC 3339 date-time.`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new GoogleWriteValidationError(`${label} is not a valid RFC 3339 date-time.`);
  }
  return date;
}

function validateEmailEnvelope(args) {
  const to = recipientList(args.to, "To", true);
  const cc = recipientList(args.cc, "Cc");
  const bcc = recipientList(args.bcc, "Bcc");
  if (to.length + cc.length + bcc.length > MAX_RECIPIENTS) {
    throw new GoogleWriteValidationError(
      `An email can have no more than ${MAX_RECIPIENTS} total recipients.`,
    );
  }
  const subject = requiredString(args, "subject", "Email subject", 300, {
    trim: true,
    header: true,
  });
  const body = requiredString(args, "body", "Email body", 50_000);
  return {
    to: to.join(", "),
    ...(cc.length ? { cc: cc.join(", ") } : {}),
    ...(bcc.length ? { bcc: bcc.join(", ") } : {}),
    subject,
    body,
  };
}

function validateCalendarEvent(args) {
  const summary = requiredString(args, "summary", "Event title", 300, {
    trim: true,
  });
  const startValue = requiredString(args, "start", "Event start", 40, {
    trim: true,
  });
  const endValue =
    args.end === undefined || args.end === null || args.end === ""
      ? undefined
      : requiredString(args, "end", "Event end", 40, { trim: true });
  const start = rfc3339Date(startValue, "Event start");
  const end = endValue
    ? rfc3339Date(endValue, "Event end")
    : new Date(start.getTime() + 30 * 60_000);
  if (end <= start) {
    throw new GoogleWriteValidationError("Event start and end times are invalid.");
  }
  const description = optionalString(args, "description", "Event description", 8_000);
  const location = optionalString(args, "location", "Event location", 500);
  const attendees = attendeeList(args.attendees);
  const eventTimezone = timezone(args.timezone);
  return {
    summary,
    ...(description === undefined ? {} : { description }),
    ...(location === undefined ? {} : { location }),
    start: start.toISOString(),
    end: end.toISOString(),
    ...(attendees.length ? { attendees } : {}),
    ...(eventTimezone ? { timezone: eventTimezone } : {}),
  };
}

export function foldEmailAddressHeader(name, value, maxLineLength = 78) {
  if (
    !["To", "Cc", "Bcc"].includes(name) ||
    typeof value !== "string" ||
    HEADER_BREAK.test(value)
  ) {
    throw new GoogleWriteValidationError("Invalid email header.");
  }
  if (!Number.isSafeInteger(maxLineLength) || maxLineLength < 20 || maxLineLength > 998) {
    throw new TypeError("Invalid MIME line length.");
  }
  const addresses = value.split(", ").filter(Boolean);
  if (addresses.length === 0) {
    throw new GoogleWriteValidationError("Invalid email header.");
  }
  let current = `${name}: ${addresses[0]}`;
  const lines = [];
  for (const address of addresses.slice(1)) {
    const addition = `, ${address}`;
    if (current.length + addition.length <= maxLineLength) {
      current += addition;
    } else {
      lines.push(`${current},`);
      current = ` ${address}`;
    }
  }
  lines.push(current);
  if (lines.some((line) => line.length > 998)) {
    throw new GoogleWriteValidationError("Email header is too long.");
  }
  return lines.join("\r\n");
}

export function encodeMimeTextBody(value) {
  if (typeof value !== "string") {
    throw new TypeError("MIME body must be a string.");
  }
  const encoded = Buffer.from(value, "utf8").toString("base64");
  return encoded.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

export function validateSupportedGoogleWrite(tool, input) {
  if (!SUPPORTED_WRITE_TOOLS.has(tool)) {
    throw new GoogleWriteValidationError("This Google action is not supported.");
  }
  const args = requireRecord(input);
  return tool === "calendar_create_event"
    ? validateCalendarEvent(args)
    : validateEmailEnvelope(args);
}
