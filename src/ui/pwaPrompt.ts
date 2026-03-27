export interface InstallPwaPromptOptions {
  onApplyUpdate: () => void | Promise<void>;
}

function createPwaPromptRoot(): HTMLDivElement {
  const existing = document.getElementById("pwa-status-toast");
  if (existing) return existing as HTMLDivElement;

  const root = document.createElement("div");
  root.id = "pwa-status-toast";
  root.className = "pwa-status-toast hidden";
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");

  const title = document.createElement("p");
  title.id = "pwa-status-title";
  title.className = "pwa-status-title";

  const body = document.createElement("p");
  body.id = "pwa-status-body";
  body.className = "pwa-status-body";

  const actions = document.createElement("div");
  actions.id = "pwa-status-actions";
  actions.className = "pwa-status-actions";

  root.append(title, body, actions);
  document.body.appendChild(root);
  return root;
}

function showToast(
  titleText: string,
  bodyText: string,
  actionsBuilder: (actions: HTMLDivElement, close: () => void) => void,
): void {
  const root = createPwaPromptRoot();
  const title = document.getElementById(
    "pwa-status-title",
  ) as HTMLParagraphElement;
  const body = document.getElementById(
    "pwa-status-body",
  ) as HTMLParagraphElement;
  const actions = document.getElementById(
    "pwa-status-actions",
  ) as HTMLDivElement;

  const close = () => root.classList.add("hidden");

  title.textContent = titleText;
  body.textContent = bodyText;
  actions.replaceChildren();
  actionsBuilder(actions, close);
  root.classList.remove("hidden");
}

function buildButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "pwa-status-button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

export function installPwaPrompt(options: InstallPwaPromptOptions): {
  showUpdateReady: () => void;
  showOfflineReady: () => void;
} {
  return {
    showUpdateReady: () => {
      showToast(
        "Update ready",
        "A newer version is available. Update when you are ready so you do not lose current settings.",
        (actions, close) => {
          actions.append(
            buildButton("UPDATE NOW", () => {
              close();
              void options.onApplyUpdate();
            }),
            buildButton("LATER", close),
          );
        },
      );
    },
    showOfflineReady: () => {
      showToast(
        "Offline shell ready",
        "The app shell is cached for this browser. Some heavier features may still need a first online load.",
        (actions, close) => {
          actions.append(buildButton("OK", close));
        },
      );
    },
  };
}
