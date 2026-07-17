(() => {
  const slides = [...document.querySelectorAll(".slide")];
  if (!slides.length) return;

  let current = 0;
  const authoredDisplay = new Map(slides.map((slide) => [slide, slide.style.display]));
  const clamp = (index) => Math.max(0, Math.min(slides.length - 1, index));

  function goTo(index) {
    current = clamp(Number(index) || 0);
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
    history.replaceState(null, "", `#${current + 1}`);
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

  window.__niceDeck = {
    count: slides.length,
    current: () => current,
    goTo,
  };

  const initial = Number(location.hash.slice(1)) - 1;
  goTo(Number.isInteger(initial) && initial >= 0 ? initial : 0);
})();
