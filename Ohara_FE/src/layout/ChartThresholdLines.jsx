const THRESHOLD_COLORS = {
  warning: "#FFD700",
  alarm: "#c90909",
};

const CHART_THRESHOLD_CONFIG = {
  moldTemp: {
    baseKey: "moldTempBase",
    warningKey: "moldTempWarningDelta",
    alarmKey: "moldTempAlarmDelta",
    unit: "°C",
    label: "Mold Temp",
  },
  envTemp: {
    baseKey: "envTempBase",
    warningKey: "envTempWarningDelta",
    alarmKey: "envTempAlarmDelta",
    unit: "°C",
    label: "Temp",
  },
  hum: {
    baseKey: "humidityBase",
    warningKey: "humidityWarningDelta",
    alarmKey: "humidityAlarmDelta",
    unit: "%",
    label: "Humidity",
  },
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
const toFiniteNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

export const formatThresholdValue = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  return Number.isInteger(num) ? String(num) : String(Number(num.toFixed(1)));
};

const getThresholdTypeText = (level, side) => {
  const levelText = level === "alarm" ? "Alarm" : "Warning";
  const sideText = side === "high" ? "High" : "Low";

  return `${levelText} ${sideText}`;
};

export const formatThresholdTooltip = (metaInput = {}) => {
  const metas = (Array.isArray(metaInput) ? metaInput : [metaInput]).filter(
    Boolean
  );

  if (metas.length === 0) return "";

  const first = metas[0];
  const typeText = getThresholdTypeText(first.level, first.side);
  const chartLabel = first.chartLabel || "Threshold";
  const titleColor = first.lineColor || "#111827";

  const machineRows = metas
    .map((meta) => {
      const machineName = escapeHtml(meta.machineName || "");
      const machineValueText = formatThresholdValue(meta.value);
      const machineUnit = meta.unit || "";
      const machineColor = meta.machineColor || "#111827";

      return `
        <div style="
          margin-top:4px;
          display:flex;
          align-items:center;
          gap:5px;
          white-space:nowrap;
          color:#111827;
        ">
          <span style="
            width:9px;
            height:9px;
            border-radius:999px;
            background:${escapeHtml(machineColor)};
            display:inline-block;
            flex:0 0 auto;
          "></span>

          <span>
            <b>${machineName}</b>: ${machineValueText}${machineUnit}
          </span>
        </div>
      `;
    })
    .join("");

  return `
    <div style="min-width:170px">
      <div style="
        font-weight:900;
        margin-bottom:6px;
        color:${escapeHtml(titleColor)};
        white-space:nowrap;
      ">
        ${escapeHtml(chartLabel)} - ${escapeHtml(typeText)}
      </div>

      ${machineRows}
    </div>
  `;
};

export const buildThresholdMarkLines = ({
  chartKey,
  thresholdSettingsByMachineId,
  selectedMachineIds,
  machineNameMap,
  machineColorMap,
}) => {
  const config = CHART_THRESHOLD_CONFIG[chartKey];

  if (!config || !thresholdSettingsByMachineId) return [];

  const safeMachineIds = Array.isArray(selectedMachineIds)
    ? selectedMachineIds
    : [];

  const groupedLines = new Map();

  const addThresholdLine = ({
    machineName,
    machineColor,
    value,
    base,
    delta,
    level,
    side,
    color,
    opacity,
  }) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return;

    const key = `${numericValue}|${level}|${side}|${color}`;

    const meta = {
      machineName,
      machineColor,
      lineColor: color,
      chartLabel: config.label,
      value: numericValue,
      base,
      delta,
      level,
      side,
      unit: config.unit,
    };

    if (!groupedLines.has(key)) {
      groupedLines.set(key, {
        name: `${getThresholdTypeText(level, side)} ${formatThresholdValue(
          numericValue
        )}${config.unit}`,
        yAxis: numericValue,
        thresholdMeta: [meta],
        lineStyle: {
          color,
          width: 1.2,
          type: "solid",
          opacity,
        },
        emphasis: {
          lineStyle: {
            color,
            width: 2.4,
            opacity: 0.95,
          },
        },
        label: {
          formatter: formatThresholdValue(numericValue),
          color,
          fontWeight: 700,
        },
      });

      return;
    }

    groupedLines.get(key).thresholdMeta.push(meta);
  };

  safeMachineIds.forEach((machineId) => {
    const setting = thresholdSettingsByMachineId[machineId];

    if (!setting) return;

    const base = toFiniteNumber(setting[config.baseKey]);
    const warningDelta = toFiniteNumber(setting[config.warningKey]);
    const alarmDelta = toFiniteNumber(setting[config.alarmKey]);

    if (base === null) return;

    const machineName = machineNameMap?.[machineId] || `Machine ${machineId}`;
    const machineColor = machineColorMap?.[machineId] || "#111827";

    if (warningDelta !== null && warningDelta > 0) {
      addThresholdLine({
        machineName,
        machineColor,
        value: base - warningDelta,
        base,
        delta: warningDelta,
        level: "warning",
        side: "low",
        color: THRESHOLD_COLORS.warning,
        opacity: 0.55,
      });

      addThresholdLine({
        machineName,
        machineColor,
        value: base + warningDelta,
        base,
        delta: warningDelta,
        level: "warning",
        side: "high",
        color: THRESHOLD_COLORS.warning,
        opacity: 0.55,
      });
    }

    if (alarmDelta !== null && alarmDelta > 0) {
      addThresholdLine({
        machineName,
        machineColor,
        value: base - alarmDelta,
        base,
        delta: alarmDelta,
        level: "alarm",
        side: "low",
        color: THRESHOLD_COLORS.alarm,
        opacity: 0.68,
      });

      addThresholdLine({
        machineName,
        machineColor,
        value: base + alarmDelta,
        base,
        delta: alarmDelta,
        level: "alarm",
        side: "high",
        color: THRESHOLD_COLORS.alarm,
        opacity: 0.68,
      });
    }
  });

  return Array.from(groupedLines.values()).sort(
    (a, b) => Number(a.yAxis) - Number(b.yAxis)
  );
};