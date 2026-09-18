import { chromium } from "playwright";
import { launchTestBrowser } from "./browser.mjs";

// Internal exporter/direction launches have no supplied-browser parameter.
// --import installs the same test-only seam in test workers and (via
// NODE_OPTIONS below) child processes, without a production environment hook.
chromium.launch = launchTestBrowser;
const preload = `--import=${JSON.stringify(import.meta.url)}`;
if (!(process.env.NODE_OPTIONS ?? "").includes(import.meta.url)) {
  process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, preload].filter(Boolean).join(" ");
}
