(() => {
  const slides = [...document.querySelectorAll(".slide")];
  if (!slides.length) return;

  const designWidth = Number(document.documentElement.dataset.deckWidth) || 1600;
  const designHeight = Number(document.documentElement.dataset.deckHeight) || 900;
  let canvas = slides[0].parentElement;
  if (!canvas || canvas === document.body || slides.some((slide) => slide.parentElement !== canvas)) {
    canvas = document.createElement("main");
    document.body.insertBefore(canvas, slides[0]);
    for (const slide of slides) canvas.append(slide);
  }

  const viewport = document.createElement("div");
  viewport.className = "nice-deck-viewport";
  canvas.parentElement.insertBefore(viewport, canvas);
  viewport.append(canvas);
  canvas.classList.add("nice-deck-canvas");

  const runtimeStyle = document.createElement("style");
  runtimeStyle.dataset.niceDeckRuntime = "true";
  runtimeStyle.textContent = `
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
    }
    body {
      margin: 0;
    }
    .nice-deck-viewport {
      position: fixed;
      inset: 0;
      overflow: hidden;
    }
    .nice-deck-canvas {
      position: absolute;
      left: 50%;
      top: 50%;
      width: var(--nice-deck-design-width);
      height: var(--nice-deck-design-height);
      transform: translate(-50%, -50%) scale(var(--nice-deck-scale));
      transform-origin: center center;
    }
  `;
  document.head.append(runtimeStyle);

  document.documentElement.style.setProperty("--nice-deck-design-width", `${designWidth}px`);
  document.documentElement.style.setProperty("--nice-deck-design-height", `${designHeight}px`);
  document.documentElement.style.setProperty("--nice-deck-scale", "1");
  for (const slide of slides) {
    slide.style.setProperty("width", `${designWidth}px`, "important");
    slide.style.setProperty("height", `${designHeight}px`, "important");
  }

  let current = 0;
  let scale = 1;
  let viewportWidth = designWidth;
  let viewportHeight = designHeight;
  let settleGeneration = 0;
  let settled = Promise.resolve();
  const authoredDisplay = new Map(slides.map((slide) => [slide, slide.style.display]));
  const clamp = (index) => Math.max(0, Math.min(slides.length - 1, index));

  function fit() {
    const rect = viewport.getBoundingClientRect();
    viewportWidth = rect.width;
    viewportHeight = rect.height;
    scale = Math.min(rect.width / designWidth, rect.height / designHeight);
    document.documentElement.style.setProperty("--nice-deck-scale", String(scale));
    const generation = ++settleGeneration;
    document.documentElement.dataset.niceDeckSettled = "false";
    settled = new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (generation === settleGeneration) {
          document.documentElement.dataset.niceDeckSettled = "true";
          dispatchEvent(new CustomEvent("nice-deck:resize", {
            detail: { designWidth, designHeight, scale, viewportWidth, viewportHeight },
          }));
        }
        resolve();
      }));
    });
  }

  // Accepts an index or a slide id so citation anchors such as #ptu-extract
  // navigate the deck instead of resetting it to the first slide.
  function indexOf(target) {
    if (typeof target === "number") return clamp(target);
    const text = String(target ?? "").replace(/^#/, "");
    const byId = slides.findIndex((slide) => slide.id === text);
    if (byId >= 0) return byId;
    const number = Number(text);
    return Number.isFinite(number) && text.trim() !== "" ? clamp(number - 1) : 0;
  }

  function goTo(index) {
    current = typeof index === "number" ? clamp(Number(index) || 0) : indexOf(index);
    slides.forEach((slide, slideIndex) => {
      const active = slideIndex === current;
      slide.hidden = !active;
      if (active) slide.style.display = authoredDisplay.get(slide);
      else slide.style.display = "none";
      slide.classList.toggle("is-active", active);
      slide.setAttribute("aria-hidden", String(!active));
      if ("inert" in slide) slide.inert = !active;
    });
    document.documentElement.style.setProperty(
      "--slide-progress",
      String((current + 1) / slides.length),
    );
    history.replaceState(null, "", `#${slides[current].id || current + 1}`);
    dispatchEvent(new CustomEvent("nice-deck:slide", {
      detail: { index: current, count: slides.length },
    }));
    return current;
  }

  addEventListener("keydown", (event) => {
    if (["ArrowRight", "PageDown", " "].includes(event.key)) {
      event.preventDefault();
      goTo(current + 1);
    } else if (["ArrowLeft", "PageUp"].includes(event.key)) {
      event.preventDefault();
      goTo(current - 1);
    } else if (event.key === "Home") {
      goTo(0);
    } else if (event.key === "End") {
      goTo(slides.length - 1);
    }
  });

  addEventListener("hashchange", () => {
    const target = indexOf(location.hash);
    if (target !== current) goTo(target);
  });

  window.__niceDeck = {
    count: slides.length,
    current: () => current,
    geometry: () => ({
      designWidth,
      designHeight,
      scale,
      viewportWidth,
      viewportHeight,
    }),
    goTo,
    indexOf,
    whenSettled: async () => {
      while (document.documentElement.dataset.niceDeckSettled !== "true") {
        await settled;
        if (document.documentElement.dataset.niceDeckSettled !== "true") {
          await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
        }
      }
    },
  };

  new ResizeObserver(fit).observe(viewport);
  fit();
  goTo(location.hash ? indexOf(location.hash) : 0);
})();
