export const WIDESCREEN_SIDEBAR_LAYOUT_KEY =
  "rtjpeg.widescreenSidebarLayout.v1";

export type WidescreenSidebarLayout = "split" | "both-left" | "both-right";

export const DEFAULT_WIDESCREEN_SIDEBAR_LAYOUT: WidescreenSidebarLayout =
  "split";

const LAYOUT_VALUES: WidescreenSidebarLayout[] = [
  "split",
  "both-left",
  "both-right",
];

function parseStored(raw: string | null): WidescreenSidebarLayout {
  if (raw && (LAYOUT_VALUES as readonly string[]).includes(raw)) {
    return raw as WidescreenSidebarLayout;
  }
  return DEFAULT_WIDESCREEN_SIDEBAR_LAYOUT;
}

export function readWidescreenSidebarLayout(): WidescreenSidebarLayout {
  try {
    return parseStored(localStorage.getItem(WIDESCREEN_SIDEBAR_LAYOUT_KEY));
  } catch {
    return DEFAULT_WIDESCREEN_SIDEBAR_LAYOUT;
  }
}

function setMainLayoutAttr(
  main: HTMLElement,
  layout: WidescreenSidebarLayout,
): void {
  main.dataset.wsLayout = layout;
}

function syncLayoutButtons(active: WidescreenSidebarLayout): void {
  const ids: [WidescreenSidebarLayout, string][] = [
    ["split", "ws-layout-split-btn"],
    ["both-left", "ws-layout-both-left-btn"],
    ["both-right", "ws-layout-both-right-btn"],
  ];
  for (const [layout, id] of ids) {
    const btn = document.getElementById(id);
    if (btn instanceof HTMLButtonElement) {
      btn.setAttribute("aria-pressed", String(layout === active));
    }
  }
}

export function applyWidescreenSidebarLayout(
  layout: WidescreenSidebarLayout,
  options?: { persist?: boolean },
): void {
  const main = document.getElementById("app-main");
  if (!main) return;

  const persist = options?.persist !== false;
  setMainLayoutAttr(main, layout);
  syncLayoutButtons(layout);

  if (persist) {
    try {
      localStorage.setItem(WIDESCREEN_SIDEBAR_LAYOUT_KEY, layout);
    } catch {
      /* ignore quota / private mode */
    }
  }
}

export function initWidescreenSidebarLayout(): void {
  const initial = readWidescreenSidebarLayout();
  applyWidescreenSidebarLayout(initial, { persist: false });

  document
    .getElementById("ws-layout-split-btn")
    ?.addEventListener("click", () => applyWidescreenSidebarLayout("split"));
  document
    .getElementById("ws-layout-both-left-btn")
    ?.addEventListener("click", () =>
      applyWidescreenSidebarLayout("both-left"),
    );
  document
    .getElementById("ws-layout-both-right-btn")
    ?.addEventListener("click", () =>
      applyWidescreenSidebarLayout("both-right"),
    );
}
