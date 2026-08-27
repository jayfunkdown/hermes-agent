import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import "./index.css";
import App from "./App";
import { SystemActionsProvider } from "./contexts/SystemActions";
import { I18nProvider } from "./i18n";
import { exposePluginSDK } from "./plugins";
import { ThemeProvider } from "./themes";
import { HERMES_BASE_PATH } from "./lib/api";
import { registerMobileServiceWorker } from "./lib/mobile-sw-update";

const basePath = HERMES_BASE_PATH || "";
if (typeof document !== "undefined") {
  const manifestHref = basePath ? `${basePath}/manifest.webmanifest` : "/manifest.webmanifest";
  let manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!manifest) {
    manifest = document.createElement("link");
    manifest.rel = "manifest";
    document.head.appendChild(manifest);
  }
  manifest.href = manifestHref;

  const apple = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
  if (!apple) {
    const touch = document.createElement("link");
    touch.rel = "apple-touch-icon";
    touch.href = basePath ? `${basePath}/apple-touch-icon.png` : "/apple-touch-icon.png";
    document.head.appendChild(touch);
  }
}

registerMobileServiceWorker(basePath ? `${basePath}/sw.js` : "/sw.js");

// Expose the plugin SDK before rendering so plugins loaded via <script>
// can access React, components, etc. immediately.
exposePluginSDK();

createRoot(document.getElementById("root")!).render(
  <BrowserRouter basename={HERMES_BASE_PATH || undefined}>
    <I18nProvider>
      <ThemeProvider>
        <SystemActionsProvider>
          <App />
        </SystemActionsProvider>
      </ThemeProvider>
    </I18nProvider>
  </BrowserRouter>,
);
