import { CHANGELOG_ENTRIES } from "../../runtime/changelog";
import { MONO_BUTTON_CLASS } from "../uiClasses";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildChangelogBodyHtml(): string {
  return CHANGELOG_ENTRIES.map(
    (entry) => `
          <section class="mb-4 last:mb-0">
            <h3 class="font-mono text-[9px] font-black uppercase tracking-[0.14em] text-black dark:text-white">
              ${escapeHtml(entry.version)}${
                entry.date
                  ? ` <span class="text-subtitle font-bold normal-case tracking-normal">· ${escapeHtml(entry.date)}</span>`
                  : ""
              }
            </h3>
            <ul class="mt-1.5 list-disc pl-4 font-mono text-[11px] font-medium text-black dark:text-white/90 leading-relaxed space-y-0.5">
              ${entry.items
                .map((item) => `<li>${escapeHtml(item)}</li>`)
                .join("")}
            </ul>
          </section>`,
  ).join("");
}

export function renderChangelogModal(): string {
  return `
    <div id="changelog-modal"
      class="hidden fixed inset-0 z-[150] items-center justify-center bg-black/70 p-3"
      role="dialog"
      aria-modal="true"
      aria-labelledby="changelog-modal-title">
      <div
        class="w-full max-w-[28rem] border-4 border-black dark:border-white bg-white dark:bg-panel max-h-[min(100%,36rem)] flex flex-col overflow-hidden">
        <div class="h-1 w-full bg-black dark:bg-white shrink-0" aria-hidden="true"></div>
        <div class="p-3 flex flex-col gap-3 min-h-0">
          <div class="flex items-start gap-2 shrink-0">
            <div class="min-w-0 flex-1">
              <h2 id="changelog-modal-title"
                class="font-mono text-[10px] font-black uppercase tracking-[0.16em] text-black dark:text-white">Changelog</h2>
              <p class="font-mono text-[8px] font-bold text-subtitle leading-snug mt-0.5">Recent release notes for this build.</p>
            </div>
            <button type="button" id="changelog-close-btn" title="Close changelog"
              class="${MONO_BUTTON_CLASS} shrink-0">Close</button>
          </div>
          <div id="changelog-modal-body" class="overflow-y-auto min-h-0 pr-1 -mr-1">
            ${buildChangelogBodyHtml()}
          </div>
        </div>
      </div>
    </div>`;
}
