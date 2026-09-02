(function niceDeckChartsRuntime(global) {
  "use strict";

  const claimColors = Object.freeze({
    measured: "#0067b8",
    derived: "#385f8a",
    "public assumption": "#9a5a00",
    "historical assumption": "#66717d",
    "illustrative scenario": "#b4235a",
  });
  const palette = Object.freeze({
    ink: "#11151a",
    muted: "#596777",
    grid: "#d7dde4",
    white: "#ffffff",
    ...claimColors,
  });
  const charts = new Set();
  const pending = new Set();
  const captureMode = new URLSearchParams(global.location.search).get("capture") === "1";
  const reducedMotion = global.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const theme = {
    color: [
      claimColors.measured,
      claimColors.derived,
      claimColors["public assumption"],
      claimColors["illustrative scenario"],
    ],
    backgroundColor: "transparent",
    textStyle: {
      color: palette.ink,
      fontFamily: 'system-ui, "Segoe UI", sans-serif',
      fontSize: 18,
    },
    tooltip: {
      backgroundColor: palette.ink,
      borderWidth: 0,
      textStyle: { color: palette.white, fontSize: 15 },
      extraCssText: "box-shadow:none;border-radius:0;",
    },
    categoryAxis: {
      axisLine: { lineStyle: { color: palette.ink, width: 1.5 } },
      axisTick: { show: false },
      axisLabel: { color: palette.muted, fontSize: 16 },
      splitLine: { show: false },
    },
    valueAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: palette.muted, fontSize: 15 },
      splitLine: { lineStyle: { color: palette.grid, width: 1 } },
    },
  };

  function renderFailure(element, message) {
    element.dataset.chartReady = "false";
    element.dataset.chartError = "true";
    element.replaceChildren();
    const error = document.createElement("div");
    error.className = "nice-deck-chart-error";
    error.setAttribute("role", "alert");
    error.textContent = `Chart unavailable: ${message}`;
    element.append(error);
  }

  function dimensions(element) {
    const rect = element.getBoundingClientRect();
    return { height: rect.height, width: rect.width };
  }

  function waitForDimensions(element, timeoutMs = 3000) {
    const initial = dimensions(element);
    if (initial.width > 0 && initial.height > 0) return Promise.resolve(initial);

    return new Promise((resolveDimensions, reject) => {
      const timeout = setTimeout(() => {
        observer.disconnect();
        reject(new Error("container remained zero-dimensional"));
      }, timeoutMs);
      const observer = new ResizeObserver(() => {
        const current = dimensions(element);
        if (current.width <= 0 || current.height <= 0) return;
        clearTimeout(timeout);
        observer.disconnect();
        resolveDimensions(current);
      });
      observer.observe(element);
    });
  }

  function updateReadyPromise() {
    global.__NICE_DECK_CHARTS_READY__ = Promise.all([...pending]).then(() => true);
  }

  function validateContract(element, option, metadata) {
    const required = ["units", "takeaway", "decisionRelevance", "claimStatus", "archetype"];
    for (const field of required) {
      if (!metadata[field]) throw new Error(`missing chart metadata: ${field}`);
    }
    if (!claimColors[metadata.claimStatus]) {
      throw new Error(`unsupported claim status: ${metadata.claimStatus}`);
    }
    if (option.legend && option.legend.show !== false) {
      throw new Error("authored charts use direct labels, not a default legend");
    }
    for (const series of option.series ?? []) {
      for (const line of series.markLine?.data ?? []) {
        const label = line.label ?? series.markLine?.label;
        if (!line.name || !label?.formatter) {
          throw new Error("reference lines require an inline name and label");
        }
      }
    }
    element.dataset.chartUnits = metadata.units;
    element.dataset.visibleTakeaway = metadata.takeaway;
    element.dataset.decisionRelevance = metadata.decisionRelevance;
    element.dataset.claimStatus = metadata.claimStatus;
    element.dataset.chartArchetype = metadata.archetype;
    element.dataset.directLabels = "true";
  }

  function authoredOption(option) {
    const animation = captureMode || reducedMotion ? false : option.animation === true;
    return {
      ...option,
      animation,
      animationDuration: animation ? 420 : 0,
      animationDurationUpdate: animation ? 220 : 0,
      animationEasing: "cubicOut",
      animationEasingUpdate: "cubicOut",
      aria: { enabled: true, decal: { show: false }, ...option.aria },
      legend: { show: false, ...option.legend },
      textStyle: { ...theme.textStyle, ...option.textStyle },
    };
  }

  function resetChart(entry) {
    const { chart, defaults } = entry;
    chart.dispatchAction({ type: "hideTip" });
    chart.dispatchAction({ type: "downplay", seriesIndex: "all" });
    for (const range of defaults.dataZoom ?? []) {
      chart.dispatchAction({ type: "dataZoom", ...range });
    }
  }

  function create(element, option, metadata = {}, defaults = {}) {
    if (!(element instanceof Element)) {
      throw new TypeError("niceDeckCharts.create requires a chart element");
    }
    element.dataset.chartReady = "false";
    element.dataset.echart = "true";

    const task = Promise.resolve().then(async () => {
      if (!global.echarts) throw new Error("Apache ECharts runtime is unavailable");
      validateContract(element, option, metadata);
      await waitForDimensions(element);
      const chart = global.echarts.init(element, theme, { renderer: "svg" });
      const entry = { chart, defaults, element, metadata };
      charts.add(entry);
      chart.setOption(authoredOption(option), { notMerge: true, lazyUpdate: false });
      chart.resize();
      resetChart(entry);
      element.dataset.chartReady = "true";
      delete element.dataset.chartError;
      return entry;
    }).catch((error) => {
      renderFailure(element, error.message);
      throw error;
    });

    pending.add(task);
    task.finally(() => {
      pending.delete(task);
      updateReadyPromise();
    });
    updateReadyPromise();
    return task;
  }

  async function resizeVisible() {
    await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
    for (const entry of charts) {
      if (entry.element.closest(".slide")?.hidden) continue;
      const current = dimensions(entry.element);
      if (current.width <= 0 || current.height <= 0) continue;
      entry.chart.resize();
      entry.element.dataset.chartReady = "true";
    }
  }

  async function prepareCapture() {
    await global.__NICE_DECK_CHARTS_READY__;
    for (const entry of charts) {
      resetChart(entry);
      const current = dimensions(entry.element);
      if (current.width > 0 && current.height > 0) entry.chart.resize();
      entry.element.dataset.chartReady = "true";
    }
    await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
    return true;
  }

  async function prepareVisible() {
    await resizeVisible();
    for (const entry of charts) {
      if (entry.element.closest(".slide")?.hidden) continue;
      resetChart(entry);
      entry.chart.resize();
      entry.element.dataset.chartReady = "true";
    }
    await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
    return true;
  }

  function dispose() {
    for (const { chart, element } of charts) {
      chart.dispose();
      element.dataset.chartReady = "false";
    }
    charts.clear();
  }

  const archetypes = Object.freeze({
    scenario({ categories, values, reference, valueFormatter }) {
      return {
        grid: { top: 46, right: 48, bottom: 52, left: 72 },
        xAxis: { type: "category", data: categories },
        yAxis: { type: "value" },
        series: [{
          type: "bar",
          data: values,
          label: {
            show: true,
            position: "top",
            formatter: ({ value }) => valueFormatter(value),
            fontFamily: "ui-monospace, Consolas, monospace",
            fontSize: 17,
            fontWeight: 600,
          },
          markLine: reference ? {
            symbol: "none",
            data: [{
              name: reference.name,
              yAxis: reference.value,
              label: {
                formatter: `${reference.name}  ${valueFormatter(reference.value)}`,
                position: "insideEndTop",
              },
            }],
          } : undefined,
        }],
      };
    },
    comparison({ categories, values, valueFormatter }) {
      return {
        grid: { top: 32, right: 70, bottom: 52, left: 150 },
        xAxis: { type: "value" },
        yAxis: { type: "category", data: categories },
        series: [{
          type: "bar",
          data: values,
          label: {
            show: true,
            position: "right",
            formatter: ({ value }) => valueFormatter(value),
            fontFamily: "ui-monospace, Consolas, monospace",
            fontSize: 17,
            fontWeight: 600,
          },
        }],
      };
    },
    trend({ categories, values, valueFormatter }) {
      return {
        grid: { top: 42, right: 36, bottom: 52, left: 70 },
        xAxis: { type: "category", data: categories },
        yAxis: { type: "value" },
        series: [{
          type: "line",
          data: values,
          symbolSize: 9,
          lineStyle: { width: 4 },
          label: {
            show: true,
            position: "top",
            formatter: ({ value }) => valueFormatter(value),
          },
        }],
      };
    },
  });

  global.addEventListener("resize", resizeVisible);
  global.addEventListener("nice-deck:resize", resizeVisible);
  global.addEventListener("nice-deck:slide", resizeVisible);
  global.addEventListener("nice-deck:capture", prepareCapture);
  global.__NICE_DECK_CHARTS_READY__ = Promise.resolve(true);
  global.niceDeckCharts = Object.freeze({
    archetypes,
    captureMode,
    claimColors,
    create,
    dispose,
    palette,
    prepareCapture,
    prepareVisible,
    resize: resizeVisible,
    theme: Object.freeze(theme),
  });
}(window));
