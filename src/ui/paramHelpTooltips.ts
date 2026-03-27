/** Native `title` on small controls inside scroll/labels is flaky; use a fixed overlay instead. */
export function initParamHelpFloatingTips(): void {
  if (document.getElementById("param-help-tooltip")) return;

  const tip = document.createElement("div");
  tip.id = "param-help-tooltip";
  tip.setAttribute("role", "tooltip");
  document.body.appendChild(tip);

  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  const hideTip = () => {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      tip.style.display = "none";
      hideTimer = null;
    }, 50);
  };

  const showTip = (btn: HTMLButtonElement) => {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    const msg = btn.dataset.paramHelpTip;
    if (!msg) return;
    tip.textContent = msg;
    tip.style.display = "block";
    tip.style.visibility = "hidden";

    const rect = btn.getBoundingClientRect();
    const pad = 10;
    const gap = 8;
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let left = rect.left + rect.width / 2 - tw / 2;
    left = Math.max(pad, Math.min(left, window.innerWidth - tw - pad));
    let top = rect.bottom + gap;
    if (top + th > window.innerHeight - pad) {
      top = Math.max(pad, rect.top - th - gap);
    }
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
    tip.style.visibility = "visible";
  };

  const dismissOnViewportChange = () => {
    tip.style.display = "none";
  };
  window.addEventListener("scroll", dismissOnViewportChange, true);
  window.addEventListener("resize", dismissOnViewportChange);

  document.querySelectorAll("button.param-help").forEach((node) => {
    const btn = node as HTMLButtonElement;
    const t = btn.getAttribute("title");
    if (t) {
      btn.dataset.paramHelpTip = t;
      btn.removeAttribute("title");
    }
    btn.addEventListener("pointerenter", () => showTip(btn));
    btn.addEventListener("pointerleave", hideTip);
    btn.addEventListener("focus", () => showTip(btn));
    btn.addEventListener("blur", hideTip);
  });
}
