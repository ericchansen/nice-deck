import { chromium } from "playwright";

// Only tests import this module. Production launch options remain untouched.
// Capture the original method before the optional test preload patches it.
const launchChromium = chromium.launch.bind(chromium);

export function testBrowserOptions(options = {}) {
  const executablePath = process.env.NICE_DECK_TEST_BROWSER;
  return { ...(executablePath ? { executablePath } : {}), ...options };
}

export function launchTestBrowser(options = {}) {
  return launchChromium(testBrowserOptions(options));
}
