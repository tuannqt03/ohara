const THRESHOLD_LINE_STYLES = {
  warning: {
    type: "dashed",
    width: 1.3,
    opacity: 0.58,
  },
  alarm: {
    type: "dotted",
    width: 1.8,
    opacity: 0.82,
  },
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
  const titleColor = first.lineColor || first.machineColor || "#111827";

  const machineRows = metas
    .map((meta) => {
      const machineName = escapeHtml(meta.machineName || "");
      const machineValueText = formatThresholdValue(meta.value);
      const machineUnit = meta.unit || "";
      const machineColor = meta.machineColor || "#111827";
      const levelText = meta.level === "alarm" ? "Alarm" : "Warning";

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
  const settingGroups = new Map();

  const getGroupMaxThresholdValue = ({ base, warningDelta, alarmDelta }) => {
    const values = [];

    if (warningDelta !== null && warningDelta > 0) {
      values.push(base - warningDelta, base + warningDelta);
    }

    if (alarmDelta !== null && alarmDelta > 0) {
      values.push(base - alarmDelta, base + alarmDelta);
    }

    if (values.length === 0) return base;

    return Math.max(...values);
  };

  safeMachineIds.forEach((machineId) => {
    const setting = thresholdSettingsByMachineId[machineId];

    if (!setting) return;

    const base = toFiniteNumber(setting[config.baseKey]);
    const warningDelta = toFiniteNumber(setting[config.warningKey]);
    const alarmDelta = toFiniteNumber(setting[config.alarmKey]);

    if (base === null) return;

    const safeWarningDelta = warningDelta !== null ? warningDelta : null;
    const safeAlarmDelta = alarmDelta !== null ? alarmDelta : null;

    const groupKey = [
      base,
      safeWarningDelta,
      safeAlarmDelta,
    ].join("|");

    const machineName = machineNameMap?.[machineId] || `Machine ${machineId}`;
    const machineColor = machineColorMap?.[machineId] || "#111827";

    const machineMeta = {
      machineId,
      machineName,
      machineColor,
    };

    if (!settingGroups.has(groupKey)) {
      settingGroups.set(groupKey, {
        base,
        warningDelta: safeWarningDelta,
        alarmDelta: safeAlarmDelta,
        maxThresholdValue: getGroupMaxThresholdValue({
          base,
          warningDelta: safeWarningDelta,
          alarmDelta: safeAlarmDelta,
        }),
        machines: [machineMeta],
      });

      return;
    }

    settingGroups.get(groupKey).machines.push(machineMeta);
  });

  const allGroups = Array.from(settingGroups.values());

  if (allGroups.length === 0) return [];

  const visibleGroups =
  safeMachineIds.length === 1
    ? allGroups
    : allGroups.filter((group) => group.machines.length >= 2);

  const groupedLines = new Map();

  const addThresholdLine = ({
    group,
    value,
    delta,
    level,
    side,
  }) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return;

    const firstMachine = group.machines[0];
    const safeLineColor = firstMachine?.machineColor || "#111827";

    const lineStyleConfig =
      THRESHOLD_LINE_STYLES[level] || THRESHOLD_LINE_STYLES.warning;

    const key = `${numericValue}|${level}|${side}|${safeLineColor}|${lineStyleConfig.type}`;

    const metas = group.machines.map((machine) => ({
      machineName: machine.machineName,
      machineColor: machine.machineColor,
      lineColor: safeLineColor,
      chartLabel: config.label,
      value: numericValue,
      base: group.base,
      delta,
      level,
      side,
      unit: config.unit,
    }));

    if (!groupedLines.has(key)) {
      const lineTitle =
        group.machines.length >= 2
          ? `${firstMachine.machineName} +${group.machines.length - 1}`
          : firstMachine.machineName;

      groupedLines.set(key, {
        name: `${lineTitle} ${getThresholdTypeText(
          level,
          side
        )} ${formatThresholdValue(numericValue)}${config.unit}`,
        yAxis: numericValue,
        thresholdMeta: metas,
        lineStyle: {
          color: safeLineColor,
          width: lineStyleConfig.width,
          type: lineStyleConfig.type,
          opacity: lineStyleConfig.opacity,
        },
        emphasis: {
          lineStyle: {
            color: safeLineColor,
            width: lineStyleConfig.width + 0.9,
            type: lineStyleConfig.type,
            opacity: 1,
          },
        },
        label: {
          formatter: formatThresholdValue(numericValue),
          color: safeLineColor,
          fontWeight: 700,
        },
      });

      return;
    }

    groupedLines.get(key).thresholdMeta.push(...metas);
  };

  visibleGroups.forEach((group) => {
    const { base, warningDelta, alarmDelta } = group;

    if (warningDelta !== null && warningDelta > 0) {
      addThresholdLine({
        group,
        value: base - warningDelta,
        delta: warningDelta,
        level: "warning",
        side: "low",
      });

      addThresholdLine({
        group,
        value: base + warningDelta,
        delta: warningDelta,
        level: "warning",
        side: "high",
      });
    }

    if (alarmDelta !== null && alarmDelta > 0) {
      addThresholdLine({
        group,
        value: base - alarmDelta,
        delta: alarmDelta,
        level: "alarm",
        side: "low",
      });

      addThresholdLine({
        group,
        value: base + alarmDelta,
        delta: alarmDelta,
        level: "alarm",
        side: "high",
      });
    }
  });

  return Array.from(groupedLines.values()).sort(
    (a, b) => Number(a.yAxis) - Number(b.yAxis)
  );
};