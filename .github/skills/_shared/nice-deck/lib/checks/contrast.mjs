export async function auditContrast(page, slideIndex) {
  return page.evaluate((index) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const parseColor = (value) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = "rgba(0, 0, 0, 0)";
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].map(
        (channel, channelIndex) => (channelIndex === 3 ? channel / 255 : channel),
      );
    };
    const over = (foreground, background) => {
      const alpha = foreground[3] + background[3] * (1 - foreground[3]);
      if (!alpha) return [0, 0, 0, 0];
      return [
        ...[0, 1, 2].map((channel) => (
          (foreground[channel] * foreground[3]
            + background[channel] * background[3] * (1 - foreground[3])) / alpha
        )),
        alpha,
      ];
    };
    const luminance = (color) => {
      const linear = color.slice(0, 3).map((channel) => {
        const value = channel / 255;
        return value <= 0.03928
          ? value / 12.92
          : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };
    const ratio = (first, second) => {
      const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
      return (lighter + 0.05) / (darker + 0.05);
    };
    const directText = (element) => [...element.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent.trim())
      .filter(Boolean)
      .join(" ");
    const effectiveBackground = (element) => {
      const chain = [];
      let current = element;
      let hasImage = false;
      while (current instanceof Element) {
        chain.unshift(current);
        const style = getComputedStyle(current);
        if (style.backgroundImage !== "none") hasImage = true;
        current = current.parentElement;
      }

      let background = [255, 255, 255, 1];
      for (const node of chain) {
        const color = parseColor(getComputedStyle(node).backgroundColor);
        if (color) background = over(color, background);
      }
      return { background, hasImage };
    };

    const failures = [];
    const unverified = [];

    for (const element of document.body.querySelectorAll("*")) {
      const text = directText(element);
      if (!text) continue;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (
        style.display === "none"
        || style.visibility === "hidden"
        || Number(style.opacity) === 0
        || rect.width === 0
        || rect.height === 0
      ) {
        continue;
      }

      const foreground = parseColor(style.color);
      if (!foreground) continue;
      const { background, hasImage } = effectiveBackground(element);
      let cumulativeOpacity = 1;
      let hasFilter = false;
      let effectNode = element;
      while (effectNode instanceof Element) {
        const effectStyle = getComputedStyle(effectNode);
        cumulativeOpacity *= Number(effectStyle.opacity);
        if (effectStyle.filter !== "none") hasFilter = true;
        effectNode = effectNode.parentElement;
      }
      if (hasImage || cumulativeOpacity < 0.999 || hasFilter) {
        unverified.push({
          slide: index + 1,
          reason: hasImage
            ? "background-image"
            : cumulativeOpacity < 0.999
              ? "opacity"
              : "filter",
          text: text.slice(0, 80),
        });
        continue;
      }

      const renderedForeground = over(foreground, background);
      const contrast = ratio(renderedForeground, background);
      const fontSize = Number.parseFloat(style.fontSize);
      const weight = Number.parseInt(style.fontWeight, 10) || 400;
      const large = fontSize >= 24 || (fontSize >= 18.66 && weight >= 700);
      const required = large ? 3 : 4.5;

      if (contrast < required) {
        failures.push({
          slide: index + 1,
          text: text.slice(0, 80),
          foreground: style.color,
          background: `rgb(${background.slice(0, 3).map(Math.round).join(", ")})`,
          ratio: Number(contrast.toFixed(2)),
          required,
        });
      }
    }

    return { failures, unverified };
  }, slideIndex);
}
