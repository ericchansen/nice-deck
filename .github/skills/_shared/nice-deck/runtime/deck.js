(() => {
  const slides = [...document.querySelectorAll(".slide")];
  if (!slides.length) return;

  let current = 0;
  const authoredDisplay = new Map(slides.map((slide) => [slide, slide.style.display]));
  const clamp = (index) => Math.max(0, Math.min(slides.length - 1, index));

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
    goTo,
    indexOf,
  };

  goTo(location.hash ? indexOf(location.hash) : 0);
})();
