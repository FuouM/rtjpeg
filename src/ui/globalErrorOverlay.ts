import { APP_VERSION } from "../appVersion";

const MAX_CAPTURED_ERRORS = 5;
const REPORT_SEPARATOR = "\n\n----------------\n\n";

interface CapturedErrorReport {
  signature: string;
  report: string;
  summary: string;
}

function summarizeValue(value: unknown): string {
  let raw: string;
  if (value instanceof Error) {
    raw = value.message || value.name || "Error";
  } else if (typeof value === "string") {
    raw = value;
  } else {
    try {
      raw = JSON.stringify(value);
    } catch {
      raw = String(value);
    }
  }
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (collapsed.length <= 240) return collapsed;
  return `${collapsed.slice(0, 240)}…`;
}

function detailValue(value: unknown): string {
  if (value instanceof Error) {
    const parts = [value.name || "Error"];
    if (value.message) parts.push(value.message);
    if (value.stack) parts.push(value.stack);
    return parts.join("\n");
  }
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function createReport(kind: string, value: unknown): CapturedErrorReport {
  const summary = summarizeValue(value) || "Unknown error";
  const detail = detailValue(value);
  const report = [
    "RTJPEG issue report",
    `Version: ${APP_VERSION}`,
    `Type: ${kind}`,
    `Time: ${new Date().toISOString()}`,
    `URL: ${window.location.href}`,
    `User agent: ${navigator.userAgent}`,
    "",
    "Summary:",
    summary,
    "",
    "Details:",
    detail,
  ].join("\n");
  return {
    signature: `${kind}:${summary}`,
    report,
    summary,
  };
}

function ensureErrorDialog() {
  const existing = document.getElementById("global-error-dialog");
  if (existing) {
    return {
      root: existing as HTMLDivElement,
      title: document.getElementById(
        "global-error-title",
      ) as HTMLParagraphElement,
      summary: document.getElementById(
        "global-error-summary",
      ) as HTMLParagraphElement,
      textarea: document.getElementById(
        "global-error-report",
      ) as HTMLTextAreaElement,
      copyBtn: document.getElementById(
        "global-error-copy-btn",
      ) as HTMLButtonElement,
      closeBtn: document.getElementById(
        "global-error-close-btn",
      ) as HTMLButtonElement,
    };
  }

  const root = document.createElement("div");
  root.id = "global-error-dialog";
  root.className = "global-error-dialog hidden";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "global-error-title");

  const panel = document.createElement("div");
  panel.className = "global-error-panel";

  const title = document.createElement("p");
  title.id = "global-error-title";
  title.className = "global-error-title";

  const summary = document.createElement("p");
  summary.id = "global-error-summary";
  summary.className = "global-error-summary";

  const body = document.createElement("p");
  body.className = "global-error-body";
  body.textContent =
    "Copy this report and paste it into the issue tracker if this keeps happening.";

  const textarea = document.createElement("textarea");
  textarea.id = "global-error-report";
  textarea.className = "global-error-report";
  textarea.readOnly = true;
  textarea.spellcheck = false;
  textarea.setAttribute("aria-label", "Error report");

  const actions = document.createElement("div");
  actions.className = "global-error-actions";

  const copyBtn = document.createElement("button");
  copyBtn.id = "global-error-copy-btn";
  copyBtn.type = "button";
  copyBtn.className = "global-error-button";
  copyBtn.textContent = "COPY REPORT";

  const closeBtn = document.createElement("button");
  closeBtn.id = "global-error-close-btn";
  closeBtn.type = "button";
  closeBtn.className = "global-error-button";
  closeBtn.textContent = "DISMISS";

  actions.append(copyBtn, closeBtn);
  panel.append(title, summary, body, textarea, actions);
  root.appendChild(panel);
  document.body.appendChild(root);

  return { root, title, summary, textarea, copyBtn, closeBtn };
}

export function installGlobalErrorOverlay(): void {
  const reports: CapturedErrorReport[] = [];
  const seenSignatures = new Set<string>();
  const dialog = ensureErrorDialog();

  const updateDialog = () => {
    const latest = reports[reports.length - 1];
    if (!latest) return;
    dialog.title.textContent =
      reports.length > 1
        ? `Something went wrong (${reports.length} captured)`
        : "Something went wrong";
    dialog.summary.textContent = latest.summary;
    dialog.textarea.value = reports
      .map((entry) => entry.report)
      .join(REPORT_SEPARATOR);
    dialog.root.classList.remove("hidden");
    dialog.textarea.scrollTop = 0;
  };

  const dismiss = () => {
    dialog.root.classList.add("hidden");
  };

  dialog.closeBtn.addEventListener("click", dismiss);
  dialog.root.addEventListener("click", (event) => {
    if (event.target === dialog.root) dismiss();
  });

  dialog.copyBtn.addEventListener("click", async () => {
    const originalLabel = dialog.copyBtn.textContent || "COPY REPORT";
    dialog.textarea.select();
    dialog.textarea.setSelectionRange(0, dialog.textarea.value.length);
    try {
      await navigator.clipboard.writeText(dialog.textarea.value);
      dialog.copyBtn.textContent = "COPIED!";
    } catch {
      dialog.copyBtn.textContent = "SELECTED";
    }
    window.setTimeout(() => {
      dialog.copyBtn.textContent = originalLabel;
    }, 1400);
  });

  const capture = (kind: string, value: unknown) => {
    const report = createReport(kind, value);
    if (seenSignatures.has(report.signature)) {
      updateDialog();
      return;
    }
    seenSignatures.add(report.signature);
    reports.push(report);
    if (reports.length > MAX_CAPTURED_ERRORS) {
      const removed = reports.shift();
      if (removed) seenSignatures.delete(removed.signature);
    }
    updateDialog();
  };

  window.addEventListener("error", (event) => {
    capture("error", event.error ?? event.message);
  });

  window.addEventListener("unhandledrejection", (event) => {
    capture("unhandledrejection", event.reason);
  });
}
