import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Paper,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  Checkbox,
  FormControlLabel,
  IconButton,
  CircularProgress,
} from "@mui/material";
import HomeRoundedIcon from "@mui/icons-material/HomeRounded";
import * as echarts from "echarts";

import { temperatureHumidityApi } from "../config/api";
import ChartToolbar, { CHART_OPTIONS } from "./ChartToolbar";
import {
  buildThresholdMarkLines,
  formatThresholdTooltip,
} from "./ChartThresholdLines";
const DEFAULT_SAMPLE_TIME = 10;
const DISCONNECTED_LIMIT_SECONDS = 20;
const DEFAULT_TIME_OPTIONS = [
  { value: 10, label: "10s" },
  { value: 30, label: "30s" },
  { value: 60, label: "60s" },
];

const RANGE_TIME_OPTIONS = {
  under5Days: DEFAULT_TIME_OPTIONS,
  under10Days: [{ value: 60, label: "1m" }],
  under30Days: [{ value: 300, label: "5m" }],
  under3Months: [{ value: 600, label: "10m" }],
  under1Year: [{ value: 3600, label: "60m" }],
};

const MAX_CUSTOM_RANGE_DAYS = 365;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const getSampleTimePolicyByRange = (startTime, endTime) => {
  if (!startTime || !endTime) {
    return {
      blocked: false,
      options: DEFAULT_TIME_OPTIONS,
      defaultValue: DEFAULT_SAMPLE_TIME,
    };
  }

  const rangeDays = (endTime.getTime() - startTime.getTime()) / MS_PER_DAY;

  if (rangeDays > MAX_CUSTOM_RANGE_DAYS) {
    return {
      blocked: true,
      message:
        "The selected time range is longer than 1 year. Please choose a range of 1 year or less to avoid heavy data loading.",
      rangeDays,
    };
  }

  if (rangeDays <= 5) {
    return {
      blocked: false,
      options: RANGE_TIME_OPTIONS.under5Days,
      defaultValue: DEFAULT_SAMPLE_TIME,
      rangeDays,
    };
  }

  if (rangeDays <= 10) {
    return {
      blocked: false,
      options: RANGE_TIME_OPTIONS.under10Days,
      defaultValue: 60,
      rangeDays,
    };
  }

  if (rangeDays <= 30) {
    return {
      blocked: false,
      options: RANGE_TIME_OPTIONS.under30Days,
      defaultValue: 300,
      rangeDays,
    };
  }

  if (rangeDays <= 90) {
    return {
      blocked: false,
      options: RANGE_TIME_OPTIONS.under3Months,
      defaultValue: 600,
      rangeDays,
    };
  }

  return {
    blocked: false,
    options: RANGE_TIME_OPTIONS.under1Year,
    defaultValue: 3600,
    rangeDays,
  };
};

const getSafeSampleTimeForPolicy = (currentValue, policy) => {
  const normalizedValue = Number(currentValue);

  if (policy.options.some((item) => Number(item.value) === normalizedValue)) {
    return normalizedValue;
  }

  return policy.defaultValue;
};

const getSafeRealtimeSampleTime = (currentValue) =>
  getSafeSampleTimeForPolicy(currentValue, {
    options: DEFAULT_TIME_OPTIONS,
    defaultValue: DEFAULT_SAMPLE_TIME,
  });

const DEFAULT_VISIBLE_POINTS = 100;
const CHART_STORAGE_KEY = "temperatureHumidityChartStateV1";

const DEFAULT_VISIBLE_CHARTS = CHART_OPTIONS.map((item) => item.value);

const DEFAULT_CHART_AXIS_SETTINGS = {
  moldTemp: {
    min: 0,
    max: 120,
    scale: 20,
  },
  envTemp: {
    min: 0,
    max: 60,
    scale: 10,
  },
  hum: {
    min: 0,
    max: 100,
    scale: 20,
  },
};
const parseSavedDate = (value) => {
  if (value === null || value === undefined || value === "") return null;

  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) return null;

  return date;
};

const normalizeAxisSettings = (settings) => {
  if (!settings || typeof settings !== "object") {
    return DEFAULT_CHART_AXIS_SETTINGS;
  }

  return {
    moldTemp: {
      ...DEFAULT_CHART_AXIS_SETTINGS.moldTemp,
      ...(settings.moldTemp || {}),
    },
    envTemp: {
      ...DEFAULT_CHART_AXIS_SETTINGS.envTemp,
      ...(settings.envTemp || {}),
    },
    hum: {
      ...DEFAULT_CHART_AXIS_SETTINGS.hum,
      ...(settings.hum || {}),
    },
  };
};

const loadSavedChartState = () => {
  try {
    const raw = window.localStorage.getItem(CHART_STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw);

    const visibleCharts = Array.isArray(parsed.visibleCharts)
      ? parsed.visibleCharts.filter((value) =>
          CHART_OPTIONS.some((item) => item.value === value)
        )
      : null;

    return {
      visibleCharts:
        visibleCharts && visibleCharts.length > 0 ? visibleCharts : null,
      timeRange: null,
      selectedStartTime: null,
      selectedEndTime: null,
      selectedMachines: Array.isArray(parsed.selectedMachines)
        ? parsed.selectedMachines
        : null,
      chartAxisSettings: normalizeAxisSettings(parsed.chartAxisSettings),
    };
  } catch (error) {
    console.warn("Failed to load saved chart state:", error);
    return {};
  }
};

const parseDbDateTime = (value) => {
  if (!value) return null;

  const normalized = String(value).replace(" ", "T");
  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) return null;

  return date;
};

const combineDateAndTimeInput = (dateValue, timeValue) => {
  if (!dateValue || !timeValue) return null;

  const date = new Date(`${dateValue}T${timeValue}`);
  if (Number.isNaN(date.getTime())) return null;

  return date;
};

const formatApiDateTime = (date) => {
  if (!date) return "";

  const pad = (n) => String(n).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds()
  )}`;
};
const getMachineDisplayName = (machine) => {
  if (!machine) return "";

  return machine.name || "";
};

const formatTooltipDateTime = (value) => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  const pad = (n) => String(n).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds()
  )}`;
};

const getPlottedMaxTimestamp = (rows, selectedMachineIds) => {
  let maxTs = null;

  if (!Array.isArray(rows) || !Array.isArray(selectedMachineIds)) {
    return maxTs;
  }

  rows.forEach((row) => {
    const bucketTime = row.fullTime || row.realFullTime;

    selectedMachineIds.forEach((id) => {
      const isDisconnected = Boolean(row[`isDisconnected_${id}`]);

      const hasAnyValue = ["moldTemp", "temp", "hum"].some((prefix) => {
        const value = row[`${prefix}_${id}`];

        return value !== null && value !== undefined && value !== "";
      });

      const xTime =
        hasAnyValue && !isDisconnected
          ? row[`recordedAt_${id}`] || bucketTime
          : bucketTime;

      const date = parseDbDateTime(xTime);

      if (!date) return;

      const ts = date.getTime();
      maxTs = maxTs === null ? ts : Math.max(maxTs, ts);
    });
  });

  return maxTs;
};

const OUTDOOR_CHART_ID = "outdoor";
const OUTDOOR_CHART_NAME = "Outdoor";
const OUTDOOR_CHART_COLOR = "#111827";

const getSeriesColor = (id, machineColors) => {
  if (id === OUTDOOR_CHART_ID) {
    return OUTDOOR_CHART_COLOR;
  }

  const numericId = Number(id);

  if (!Number.isFinite(numericId)) {
    return "#64748b";
  }

  return machineColors[(numericId - 1) % machineColors.length];
};

const getSeriesName = (id, machineNameMap) => {
  if (id === OUTDOOR_CHART_ID) {
    return OUTDOOR_CHART_NAME;
  }

  return machineNameMap?.[id] || `Machine ${id}`;
};

const normalizeSavedSelectedMachines = (savedSelectedMachines, machineIds) => {
  if (!Array.isArray(savedSelectedMachines)) return null;

  const availableMachineIds = new Set(
    Array.isArray(machineIds) ? machineIds.map((id) => Number(id)) : []
  );

  const result = [];

  savedSelectedMachines.forEach((id) => {
    if (id === OUTDOOR_CHART_ID) {
      if (!result.includes(OUTDOOR_CHART_ID)) {
        result.push(OUTDOOR_CHART_ID);
      }
      return;
    }

    const numericId = Number(id);

    if (Number.isFinite(numericId) && availableMachineIds.has(numericId)) {
      if (!result.includes(numericId)) {
        result.push(numericId);
      }
    }
  });

  return result;
};

const DISCONNECTED_TOOLTIP_VALUE = -999999;
export default function MachineChartDialog({
  open,
  onClose,
  chartMode,
  machines,
  selectedMachines,
  setSelectedMachines,
  toggleMachine,
  machineIds,
  machineColors,
  colors,
  fontFamily,
  thresholdSettingsByMachineId,
}) {
  const savedChartState = useMemo(() => loadSavedChartState(), []);
  const hasRestoredSelectedMachinesRef = useRef(false);
  const skipNextChartStateSaveRef = useRef(false);
  const selectedMachinesRef = useRef(
    Array.isArray(selectedMachines) ? selectedMachines : []
  );
  const chartRequestRunningRef = useRef(false);
  const chartWindowModeRef = useRef("realtime"); // realtime | history | custom
  const chartWindowRangeRef = useRef({
    startTime: null,
    endTime: null,
  });

  const [visibleCharts, setVisibleCharts] = useState(
    Array.isArray(savedChartState.visibleCharts)
      ? savedChartState.visibleCharts
      : DEFAULT_VISIBLE_CHARTS
  );

  const [timeRange, setTimeRange] = useState(DEFAULT_SAMPLE_TIME);
  const [timeOptions, setTimeOptions] = useState(DEFAULT_TIME_OPTIONS);

  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [chartInitialized, setChartInitialized] = useState(false);

  const [lastRefreshAt, setLastRefreshAt] = useState(null);
  const [latestMachineMap, setLatestMachineMap] = useState({});

  const [selectedStartTime, setSelectedStartTime] = useState(null);
  const [selectedEndTime, setSelectedEndTime] = useState(null);

  const [realtimeMode, setRealtimeMode] = useState(true);
  const [settingOpen, setSettingOpen] = useState(false);
  const [xAxisDomain, setXAxisDomain] = useState(null);
  const [yZoomRange, setYZoomRange] = useState(null);

  const [chartAxisSettings, setChartAxisSettings] = useState(
    savedChartState.chartAxisSettings || DEFAULT_CHART_AXIS_SETTINGS
  );

  const machineNameMap = useMemo(() => {
    const map = machines.reduce((acc, machine) => {
      acc[machine.id] = getMachineDisplayName(machine);
      return acc;
    }, {});

    map[OUTDOOR_CHART_ID] = OUTDOOR_CHART_NAME;

    return map;
  }, [machines]);

  const noDataLimitSeconds = Math.max(
    DISCONNECTED_LIMIT_SECONDS,
    Number(timeRange || DEFAULT_SAMPLE_TIME) * 2
  );

  useEffect(() => {
    selectedMachinesRef.current = Array.isArray(selectedMachines)
      ? selectedMachines
      : [];
  }, [selectedMachines]);

  useEffect(() => {
    if (!open) {
      hasRestoredSelectedMachinesRef.current = false;
      skipNextChartStateSaveRef.current = false;
      return;
    }

    if (hasRestoredSelectedMachinesRef.current) return;
    if (!Array.isArray(machineIds) || machineIds.length === 0) return;

    const latestSavedChartState = loadSavedChartState();

    const savedSelectedMachines = normalizeSavedSelectedMachines(
      latestSavedChartState.selectedMachines,
      machineIds
    );

    hasRestoredSelectedMachinesRef.current = true;

    if (savedSelectedMachines === null) return;

    skipNextChartStateSaveRef.current = true;
    selectedMachinesRef.current = savedSelectedMachines;
    setSelectedMachines(savedSelectedMachines);
  }, [open, machineIds, setSelectedMachines]);

  useEffect(() => {
    if (!open) return;
    if (!hasRestoredSelectedMachinesRef.current) return;

    if (skipNextChartStateSaveRef.current) {
      skipNextChartStateSaveRef.current = false;
      return;
    }

    try {
      window.localStorage.setItem(
        CHART_STORAGE_KEY,
        JSON.stringify({
          visibleCharts,
          timeRange,
          selectedStartTime: selectedStartTime
            ? selectedStartTime.getTime()
            : null,
          selectedEndTime: selectedEndTime ? selectedEndTime.getTime() : null,
          selectedMachines,
          chartAxisSettings,
        })
      );
    } catch (error) {
      console.warn("Failed to save chart state:", error);
    }
  }, [
    open,
    visibleCharts,
    timeRange,
    selectedStartTime,
    selectedEndTime,
    selectedMachines,
    chartAxisSettings,
  ]);

  const loadLatestMachines = useCallback(async () => {
    try {
      const res = await temperatureHumidityApi.getLatestMachines();
      const rows = Array.isArray(res.data) ? res.data : [];

      const nextMap = rows.reduce((acc, item) => {
        acc[item.id] = item;
        return acc;
      }, {});

      setLatestMachineMap(nextMap);

      return nextMap;
    } catch (error) {
      console.error("Failed to load latest machines:", error);
      setLatestMachineMap({});
      return {};
    }
  }, []);

  const loadChartData = useCallback(
    async (
      interval,
      showLoading = true,
      startTimeValue = selectedStartTime,
      endTimeValue = selectedEndTime,
      fitDataDomain = false
    ) => {
      try {
        if (showLoading) {
          setLoading(true);
        }

        const startTime = startTimeValue ? new Date(startTimeValue) : null;
        const endTime = endTimeValue ? new Date(endTimeValue) : null;
        const isManualTimeWindow = Boolean(startTime && endTime);

        const [chartRes] = await Promise.all([
          temperatureHumidityApi.getChartData({
            interval,
            ...(isManualTimeWindow
              ? {
                  startTime: formatApiDateTime(startTime),
                  endTime: formatApiDateTime(endTime),
                }
              : {
                  points: DEFAULT_VISIBLE_POINTS,
                }),
          }),
          loadLatestMachines(),
        ]);

        const rawChartData = Array.isArray(chartRes.data) ? chartRes.data : [];

        const mappedHistory = rawChartData
          .map((row) => {
            const date = parseDbDateTime(row.fullTime || row.realFullTime);

            return {
              ...row,
              xTs: date ? date.getTime() : null,
            };
          })
          .filter((row) => row.xTs !== null)
          .sort((a, b) => a.xTs - b.xTs);

        const latestDbDate =
          mappedHistory.length > 0
            ? new Date(mappedHistory[mappedHistory.length - 1].xTs)
            : null;

        let domainStartMs;
        let domainEndMs;

        if (isManualTimeWindow) {
          // When Apply Start/End: keep the user's selected range exactly
          domainStartMs = startTime.getTime();
          domainEndMs = endTime.getTime();
        } else {
          // Realtime: take the latest data point in the DB and move back 100 steps
          const domainEndTime = latestDbDate || new Date();

          domainEndMs = domainEndTime.getTime();
          domainStartMs =
            domainEndMs - Number(interval || 10) * DEFAULT_VISIBLE_POINTS * 1000;
        }

        const nextHistory = mappedHistory.filter(
          (row) => row.xTs >= domainStartMs && row.xTs <= domainEndMs
        );

        let finalStartMs = domainStartMs;
        let finalEndMs = domainEndMs;

        // For realtime / back / next buttons: keep the X-axis aligned with the real data points
        // so the line does not have a gap compared with the Y-axis.
        if (!isManualTimeWindow && nextHistory.length > 0) {
          finalStartMs = nextHistory[0].xTs;
          finalEndMs = nextHistory[nextHistory.length - 1].xTs;
        }

        // For back/next buttons, still keep the data aligned as before.
        if (fitDataDomain && nextHistory.length > 0) {
          finalStartMs = nextHistory[0].xTs;
          finalEndMs = nextHistory[nextHistory.length - 1].xTs;
        }

        // Points are plotted by recordedAt when available. In realtime/history
        // mode, allow the right edge to follow the latest plotted point so the
        // line is not clipped after changing sample time. Custom From/To keeps
        // the user's selected range exactly.
        if (chartWindowModeRef.current !== "custom" && nextHistory.length > 0) {
          const plottedMaxTs = getPlottedMaxTimestamp(
            nextHistory,
            selectedMachines
          );
          const maxRightPaddingMs =
            Number(interval || DEFAULT_SAMPLE_TIME) * 1000;

          if (
            plottedMaxTs !== null &&
            plottedMaxTs > finalEndMs &&
            plottedMaxTs - finalEndMs <= maxRightPaddingMs
          ) {
            finalEndMs = plottedMaxTs;
          }
        }

        setHistory(nextHistory);
        setXAxisDomain([finalStartMs, finalEndMs]);

      if (showLoading) {
        setYZoomRange(null);
      }

      setLastRefreshAt(new Date(finalEndMs));
      } catch (error) {
        console.error("Failed to load chart data:", error);
        setHistory([]);

        const fallbackEnd = endTimeValue ? new Date(endTimeValue) : new Date();
        const fallbackStart = new Date(
          fallbackEnd.getTime() -
            Number(interval || 10) * DEFAULT_VISIBLE_POINTS * 1000
        );

        setXAxisDomain([fallbackStart.getTime(), fallbackEnd.getTime()]);
        setLastRefreshAt(fallbackEnd);
      } finally {
        if (showLoading) {
          setLoading(false);
        }
      }
    },
    [loadLatestMachines, selectedStartTime, selectedEndTime, selectedMachines]
  );

  useEffect(() => {
    if (!open) {
      chartRequestRunningRef.current = false;
      chartWindowModeRef.current = "realtime";
      chartWindowRangeRef.current = {
        startTime: null,
        endTime: null,
      };
      setChartInitialized(false);
      setHistory([]);
      setLastRefreshAt(null);
      setLatestMachineMap({});
      setSettingOpen(false);
      setXAxisDomain(null);
      setYZoomRange(null);
      return;
    }

    if (chartInitialized) return;

    const initChart = async () => {
  try {
    setLoading(true);

    const timeRes = await temperatureHumidityApi.getChartTimeSettings();
        const data = Array.isArray(timeRes.data) ? timeRes.data : [];

        let nextTimeOptions = DEFAULT_TIME_OPTIONS;
        let nextTimeRange = 10;

        if (data.length > 0) {
          const apiOptions = data.map((item) => ({
            value: Number(item.value || item.intervalSeconds),
            label: item.label,
            isDefault: item.isDefault,
          }));

          const optionMap = new Map();

          [...apiOptions, ...DEFAULT_TIME_OPTIONS].forEach((item) => {
            optionMap.set(Number(item.value), {
              ...item,
              value: Number(item.value),
            });
          });

          nextTimeOptions = Array.from(optionMap.values()).sort(
            (a, b) => Number(a.value) - Number(b.value)
          );

          const defaultOption =
            apiOptions.find((x) => x.isDefault) || nextTimeOptions[0];

          if (defaultOption?.value) {
            nextTimeRange = Number(defaultOption.value);
          }
        }

        const latestSavedChartState = loadSavedChartState();

        if (latestSavedChartState.timeRange) {
          nextTimeRange = latestSavedChartState.timeRange;
        }

        const savedStartTime = latestSavedChartState.selectedStartTime;
        const savedEndTime = latestSavedChartState.selectedEndTime;
        const hasSavedCustomRange =
          savedStartTime && savedEndTime && savedStartTime < savedEndTime;
        setTimeOptions(nextTimeOptions);
        setTimeRange(nextTimeRange);

        if (hasSavedCustomRange) {
          chartWindowModeRef.current = "custom";
          chartWindowRangeRef.current = {
            startTime: savedStartTime,
            endTime: savedEndTime,
          };

          setSelectedStartTime(savedStartTime);
          setSelectedEndTime(savedEndTime);
          setRealtimeMode(false);

          await loadChartData(nextTimeRange, true, savedStartTime, savedEndTime);
        } else {
          chartWindowModeRef.current = "realtime";
          chartWindowRangeRef.current = {
            startTime: null,
            endTime: null,
          };

          setSelectedStartTime(null);
          setSelectedEndTime(null);
          setRealtimeMode(true);

          await loadChartData(nextTimeRange, true, null, null);
        }

        setChartInitialized(true);
      } catch (error) {
        console.error("Failed to initialize chart:", error);
        setTimeOptions(DEFAULT_TIME_OPTIONS);
        setHistory([]);
        setLatestMachineMap({});
        setLastRefreshAt(new Date());
        setChartInitialized(true);
      } finally {
        setLoading(false);
      }
    };

    initChart();
  }, [open, chartInitialized, loadChartData]);

  useEffect(() => {
  if (!open || !chartInitialized || settingOpen) {
    return;
  }

  // Only realtime mode auto-reloads according to the sample step of 10s/30s/60s
  if (!realtimeMode) {
    return;
  }

  const safeTimeRange = Number(timeRange) || DEFAULT_SAMPLE_TIME;
  const reloadMs = safeTimeRange * 1000;

  const timer = window.setInterval(async () => {
    if (chartRequestRunningRef.current) {
      return;
    }

    chartRequestRunningRef.current = true;

    try {
      await loadChartData(safeTimeRange, false, null, null);
    } finally {
      chartRequestRunningRef.current = false;
    }
  }, reloadMs);

  return () => {
    window.clearInterval(timer);
  };
}, [
  open,
  chartInitialized,
  settingOpen,
  realtimeMode,
  timeRange,
  loadChartData,
]);
  const disconnectedMachineIds = useMemo(() => {
    if (!lastRefreshAt) return [];

    const nowTime = lastRefreshAt.getTime();

    return selectedMachines.filter((machineId) => {
      if (machineId === OUTDOOR_CHART_ID) {
        return false;
      }

      const latest = latestMachineMap[machineId];

      if (!latest?.recordedAt) {
        return true;
      }

      const recordedDate = parseDbDateTime(latest.recordedAt);

      if (!recordedDate) {
        return true;
      }

      const diffSeconds = (nowTime - recordedDate.getTime()) / 1000;

      return diffSeconds >= noDataLimitSeconds;
    });
  }, [selectedMachines, latestMachineMap, lastRefreshAt, noDataLimitSeconds]);

  const visibleHistory = useMemo(() => {
    return Array.isArray(history) ? history : [];
  }, [history]);

  const shiftTimeWindow = useCallback(
  async (direction) => {
    if (
      !xAxisDomain ||
      xAxisDomain.length !== 2 ||
      loading ||
      chartRequestRunningRef.current
    ) {
      return;
    }

    chartRequestRunningRef.current = true;

    try {
      const [currentStartMs, currentEndMs] = xAxisDomain;
      const windowMs = currentEndMs - currentStartMs;

      if (windowMs <= 0) return;

      const moveMs =
        selectedStartTime && selectedEndTime
          ? windowMs
          : Number(timeRange || 10) * DEFAULT_VISIBLE_POINTS * 1000;

      let nextStartMs = currentStartMs;
      let nextEndMs = currentEndMs;

      if (direction === "back") {
        nextStartMs = currentStartMs - moveMs;
        nextEndMs = currentEndMs - moveMs;

        const nextStart = new Date(nextStartMs);
        const nextEnd = new Date(nextEndMs);
        const nextWindowMode =
          chartWindowModeRef.current === "custom" ? "custom" : "history";

        chartWindowModeRef.current = nextWindowMode;
        chartWindowRangeRef.current = {
          startTime: nextStart,
          endTime: nextEnd,
        };

        setRealtimeMode(false);
        setSelectedStartTime(nextStart);
        setSelectedEndTime(nextEnd);

        const samplePolicy = getSampleTimePolicyByRange(nextStart, nextEnd);
        const nextTimeRange = getSafeSampleTimeForPolicy(timeRange, samplePolicy);

        setTimeOptions(samplePolicy.options);
        setTimeRange(nextTimeRange);

        await loadChartData(nextTimeRange, true, nextStart, nextEnd, false);
        return;
      }

      nextStartMs = currentStartMs + moveMs;
      nextEndMs = currentEndMs + moveMs;

      const nowMs = Date.now();

      if (nextEndMs >= nowMs) {
        const nextRealtimeTimeRange = getSafeRealtimeSampleTime(timeRange);

        chartWindowModeRef.current = "realtime";
        chartWindowRangeRef.current = {
          startTime: null,
          endTime: null,
        };

        setRealtimeMode(true);
        setSelectedStartTime(null);
        setSelectedEndTime(null);
        setTimeOptions(DEFAULT_TIME_OPTIONS);
        setTimeRange(nextRealtimeTimeRange);

        await loadChartData(nextRealtimeTimeRange, true, null, null);
        return;
      }

      const nextStart = new Date(nextStartMs);
      const nextEnd = new Date(nextEndMs);

      const samplePolicy = getSampleTimePolicyByRange(nextStart, nextEnd);
      const nextTimeRange = getSafeSampleTimeForPolicy(timeRange, samplePolicy);
      const nextWindowMode =
        chartWindowModeRef.current === "custom" ? "custom" : "history";

      chartWindowModeRef.current = nextWindowMode;
      chartWindowRangeRef.current = {
        startTime: nextStart,
        endTime: nextEnd,
      };

      setTimeOptions(samplePolicy.options);
      setTimeRange(nextTimeRange);
      setRealtimeMode(false);
      setSelectedStartTime(nextStart);
      setSelectedEndTime(nextEnd);

      await loadChartData(nextTimeRange, true, nextStart, nextEnd, false);
    } finally {
      chartRequestRunningRef.current = false;
    }
  },
  [
    xAxisDomain,
    loading,
    timeRange,
    selectedStartTime,
    selectedEndTime,
    loadChartData,
  ]
);
  const charts = useMemo(() => {
    const allCharts = [
      {
        key: "moldTemp",
        title: "Mold Temperature (°C)",
        dataPrefix: "moldTemp",
      },
      {
        key: "envTemp",
        title: "Temperature (°C)",
        dataPrefix: "temp",
      },
      {
        key: "hum",
        title: "Humidity (%)",
        dataPrefix: "hum",
      },
    ];

    return allCharts
      .filter((item) => Array.isArray(visibleCharts) && visibleCharts.includes(item.key))
      .map((item) => ({
        ...item,
        axisSetting: chartAxisSettings[item.key],
      }));
  }, [visibleCharts, chartAxisSettings]);

  const chartGridRows =
    charts.length === 1
      ? "1fr"
      : charts.length === 2
      ? "1fr 1fr"
      : charts.length === 3
      ? "1fr 1fr 1fr"
      : "1fr";

  const handleDateTimeRangeChange = useCallback(
    async (
      startDateValue,
      startTimeValue,
      endDateValue,
      endTimeValue,
      options = {}
    ) => {
      const nextStartTime = combineDateAndTimeInput(
        startDateValue,
        startTimeValue
      );
      const nextEndTime = combineDateAndTimeInput(endDateValue, endTimeValue);

      if (!nextStartTime || !nextEndTime) {
        alert("Please select both the start and end date/time");
        return false;
      }

      if (nextStartTime >= nextEndTime) {
        alert("The start time must be earlier than the end time");
        return false;
      }

      const samplePolicy = getSampleTimePolicyByRange(
        nextStartTime,
        nextEndTime
      );

      if (samplePolicy.blocked) {
        alert(samplePolicy.message);
        return false;
      }

      const nextTimeRange = getSafeSampleTimeForPolicy(
        timeRange,
        samplePolicy
      );

      if (chartRequestRunningRef.current) {
        return false;
      }

      chartRequestRunningRef.current = true;

      try {
        await options.beforeLoad?.();

        chartWindowModeRef.current = "custom";
        chartWindowRangeRef.current = {
          startTime: nextStartTime,
          endTime: nextEndTime,
        };

        setTimeOptions(samplePolicy.options);
        setTimeRange(nextTimeRange);
        setRealtimeMode(false);
        setSelectedStartTime(nextStartTime);
        setSelectedEndTime(nextEndTime);

        await loadChartData(
          nextTimeRange,
          true,
          nextStartTime,
          nextEndTime
        );

        return true;
      } finally {
        chartRequestRunningRef.current = false;
      }
    },
    [loadChartData, timeRange]
  );

  const firstSelectedMachine = selectedMachines[0];

  const title =
    chartMode === "single"
      ? `CHART ${
          firstSelectedMachine === OUTDOOR_CHART_ID
            ? OUTDOOR_CHART_NAME
            : getMachineDisplayName(
                machines.find((m) => m.id === firstSelectedMachine)
              ) || ""
        }`
      : "CHART TEMPERATURE & HUMIDITY";
  const handleSettingOpenChange = useCallback(
    async (isOpen, action) => {
      setSettingOpen(isOpen);

      if (isOpen) {
        setRealtimeMode(false);
        return;
      }

      if (action === "timeApply") {
        return;
      }

      if (selectedStartTime && selectedEndTime) {
        setRealtimeMode(false);

        await loadChartData(
          timeRange,
          true,
          selectedStartTime,
          selectedEndTime
        );

        return;
      }

      const nextRealtimeTimeRange = getSafeRealtimeSampleTime(timeRange);

      setRealtimeMode(true);
      setSelectedStartTime(null);
      setSelectedEndTime(null);
      setTimeOptions(DEFAULT_TIME_OPTIONS);
      setTimeRange(nextRealtimeTimeRange);

      await loadChartData(nextRealtimeTimeRange, true, null, null);
    },
    [loadChartData, timeRange, selectedStartTime, selectedEndTime]
  );

const resetToRealtime = useCallback(
  async (nextTimeRange = DEFAULT_SAMPLE_TIME) => {
    if (chartRequestRunningRef.current) {
      return;
    }

    chartRequestRunningRef.current = true;

    try {
      chartWindowModeRef.current = "realtime";
      chartWindowRangeRef.current = {
        startTime: null,
        endTime: null,
      };

      setTimeOptions(DEFAULT_TIME_OPTIONS);
      setTimeRange(nextTimeRange);
      setRealtimeMode(true);
      setSelectedStartTime(null);
      setSelectedEndTime(null);
      setXAxisDomain(null);
      setYZoomRange(null);

      try {
        window.localStorage.setItem(
          CHART_STORAGE_KEY,
          JSON.stringify({
            visibleCharts,
            timeRange: nextTimeRange,
            selectedStartTime: null,
            selectedEndTime: null,
            selectedMachines: selectedMachinesRef.current,
            chartAxisSettings,
          })
        );
      } catch (error) {
        console.warn("Failed to reset saved chart state:", error);
      }

      await loadChartData(nextTimeRange, true, null, null);
    } finally {
      chartRequestRunningRef.current = false;
    }
  },
  [loadChartData, visibleCharts, chartAxisSettings]
);
const handleDialogClose = useCallback(() => {
  chartWindowModeRef.current = "realtime";
  chartWindowRangeRef.current = {
    startTime: null,
    endTime: null,
  };

  setTimeOptions(DEFAULT_TIME_OPTIONS);
  setTimeRange(DEFAULT_SAMPLE_TIME);
  setRealtimeMode(true);
  setSelectedStartTime(null);
  setSelectedEndTime(null);
  setXAxisDomain(null);
  setYZoomRange(null);
  setSettingOpen(false);

  try {
    window.localStorage.setItem(
      CHART_STORAGE_KEY,
      JSON.stringify({
        visibleCharts,
        timeRange: DEFAULT_SAMPLE_TIME,
        selectedStartTime: null,
        selectedEndTime: null,
        selectedMachines: selectedMachinesRef.current,
        chartAxisSettings,
      })
    );
  } catch (error) {
    console.warn("Failed to reset saved chart state:", error);
  }

  onClose?.();
}, [onClose, visibleCharts, chartAxisSettings]);

  const saveSelectedMachinesToStorage = useCallback(
    (nextSelectedMachines) => {
      const safeNextSelectedMachines = Array.isArray(nextSelectedMachines)
        ? nextSelectedMachines
        : [];

      selectedMachinesRef.current = safeNextSelectedMachines;

      try {
        const raw = window.localStorage.getItem(CHART_STORAGE_KEY);
        const currentState = raw ? JSON.parse(raw) : {};

        window.localStorage.setItem(
          CHART_STORAGE_KEY,
          JSON.stringify({
            ...currentState,
            visibleCharts,
            timeRange,
            selectedStartTime: selectedStartTime
              ? selectedStartTime.getTime()
              : null,
            selectedEndTime: selectedEndTime
              ? selectedEndTime.getTime()
              : null,
            selectedMachines: safeNextSelectedMachines,
            chartAxisSettings,
          })
        );
      } catch (error) {
        console.warn("Failed to save selected machines:", error);
      }
    },
    [
      visibleCharts,
      timeRange,
      selectedStartTime,
      selectedEndTime,
      chartAxisSettings,
    ]
  );

  return (
    <Dialog
      open={open}
      onClose={handleDialogClose}
      maxWidth={false}
      slotProps={{
        paper: {
          sx: {
            width: "100vw",
            height: "100vh",
            maxWidth: "100vw",
            maxHeight: "100vh",
            m: 0,
            borderRadius: 0,
            overflow: "hidden",
          },
        },
      }}
    >
      <DialogTitle
        sx={{
          height: 64,
          bgcolor: colors.teal,
          color: colors.white,
          fontFamily,
          fontSize: 18,
          fontWeight: 700,
          letterSpacing: 0,
          lineHeight: "64px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          py: 0,
          px: 2.5,
        }}
      >
        {title}

        <Button
          onClick={handleDialogClose}
          startIcon={<HomeRoundedIcon />}
          sx={{
            height: 38,
            px: 1.6,
            borderRadius: 2,
            bgcolor: colors.white,
            color: colors.teal,
            fontFamily,
            fontSize: 13,
            fontWeight: 700,
            textTransform: "none",
            boxShadow: "0 2px 8px rgba(0,0,0,0.16)",
            "& .MuiButton-startIcon": {
              mr: 0.75,
            },
            "&:hover": {
              bgcolor: "#e5e7eb",
              boxShadow: "0 3px 10px rgba(0,0,0,0.18)",
              transform: "translateY(-1px)",
            },
          }}
        >
          Home
        </Button>
      </DialogTitle>

      <DialogContent
        sx={{
          bgcolor: colors.bg,
          p: 2,
          height: "calc(100vh - 64px)",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <Box
          sx={{
            height: "100%",
            width: "100%",
            display: "grid",
            gridTemplateColumns:
              chartMode === "all"
                ? "calc(100vw - 388px) 340px"
                : "calc(100vw - 32px)",
            gap: 2,
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <Box
            sx={{
              width:
                chartMode === "all"
                  ? "calc(100vw - 388px)"
                  : "calc(100vw - 32px)",
              height: "100%",
              display: "grid",
              gridTemplateRows: "64px 1fr",
              gap: 1.25,
              overflow: "hidden",
            }}
          >
            <ChartToolbar
              colors={colors}
              fontFamily={fontFamily}
              onSettingOpenChange={handleSettingOpenChange}
              visibleCharts={visibleCharts}
              setVisibleCharts={setVisibleCharts}
              chartAxisSettings={chartAxisSettings}
              setChartAxisSettings={setChartAxisSettings}
              selectedStartTime={selectedStartTime}
              selectedEndTime={selectedEndTime}
              onDateTimeRangeChange={handleDateTimeRangeChange}
              timeRange={timeRange}
              setTimeRange={setTimeRange}
              onResetTimeRange={() => resetToRealtime()}
              onTimeRangeChange={async (nextTimeRange) => {
                if (chartRequestRunningRef.current) {
                  return;
                }

                const safeNextTimeRange =
                  Number(nextTimeRange) || DEFAULT_SAMPLE_TIME;

                setTimeRange(safeNextTimeRange);

                const hasXAxisWindow =
                  Array.isArray(xAxisDomain) &&
                  xAxisDomain.length === 2 &&
                  Number.isFinite(Number(xAxisDomain[0])) &&
                  Number.isFinite(Number(xAxisDomain[1]));

                const refStartTime = chartWindowRangeRef.current.startTime;
                const refEndTime = chartWindowRangeRef.current.endTime;
                const currentStartTime = selectedStartTime || refStartTime;
                const currentEndTime = selectedEndTime || refEndTime;

                if (
                  chartWindowModeRef.current === "custom" &&
                  currentStartTime &&
                  currentEndTime
                ) {
                  chartRequestRunningRef.current = true;

                  try {
                    setRealtimeMode(false);

                    await loadChartData(
                      safeNextTimeRange,
                      true,
                      currentStartTime,
                      currentEndTime,
                      false
                    );
                  } finally {
                    chartRequestRunningRef.current = false;
                  }

                  return;
                }

                if (chartWindowModeRef.current === "history" && hasXAxisWindow) {
                  chartRequestRunningRef.current = true;

                  try {
                    setRealtimeMode(false);

                    const currentEndMs = Number(xAxisDomain[1]);
                    const nextWindowMs =
                      safeNextTimeRange * DEFAULT_VISIBLE_POINTS * 1000;
                    const nextEndTime = new Date(currentEndMs);
                    const nextStartTime = new Date(
                      currentEndMs - nextWindowMs
                    );

                    chartWindowRangeRef.current = {
                      startTime: nextStartTime,
                      endTime: nextEndTime,
                    };

                    setSelectedStartTime(nextStartTime);
                    setSelectedEndTime(nextEndTime);

                    await loadChartData(
                      safeNextTimeRange,
                      true,
                      nextStartTime,
                      nextEndTime,
                      false
                    );
                  } finally {
                    chartRequestRunningRef.current = false;
                  }

                  return;
                }

                chartWindowModeRef.current = "realtime";
                chartWindowRangeRef.current = {
                  startTime: null,
                  endTime: null,
                };

                await resetToRealtime(safeNextTimeRange);
              }}
              timeOptions={timeOptions}
              loading={loading}
              lastRefreshAt={lastRefreshAt}
            />

            <Box
              sx={{
                minHeight: 0,
                display: "grid",
                gridTemplateRows: chartGridRows,
                gap: 1,
                overflow: "hidden",
                position: "relative",
              }}
            >
              {charts.length === 0 && (
                <Paper
                  elevation={0}
                  sx={{
                    width: "100%",
                    height: "100%",
                    minWidth: 0,
                    minHeight: 0,
                    p: 1,
                    borderRadius: 3,
                    border: `1px solid ${colors.border}`,
                    bgcolor: colors.white,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily,
                    fontSize: 13,
                    fontWeight: 700,
                    color: colors.subtle,
                    overflow: "hidden",
                    boxShadow: "0 3px 10px rgba(15,23,42,0.06)",
                  }}
                >
                  No chart selected
                </Paper>
              )}

              {charts.map((chart, index) => {
                const showNavButtons = index === charts.length - 1;

                return (
                  <ChartBox
                    key={chart.key}
                    title={chart.title}
                    data={visibleHistory}
                    chartKey={chart.key}
                    thresholdSettingsByMachineId={thresholdSettingsByMachineId}
                    xAxisDomain={xAxisDomain}
                    isManualTimeWindow={Boolean(selectedStartTime && selectedEndTime)}
                    selectedMachines={selectedMachines}
                    disconnectedMachineIds={disconnectedMachineIds}
                    dataPrefix={chart.dataPrefix}
                    machineColors={machineColors}
                    colors={colors}
                    fontFamily={fontFamily}
                    axisSetting={chart.axisSetting}
                    timeRange={timeRange}
                    loading={loading}
                    machineNameMap={machineNameMap}
                    yZoomRange={yZoomRange?.[chart.key]}
                    onBack={showNavButtons ? () => shiftTimeWindow("back") : undefined}
                    onNext={showNavButtons ? () => shiftTimeWindow("next") : undefined}
                    onReset={
                      showNavButtons ? () => resetToRealtime() : undefined
                    }
                    navDisabled={!showNavButtons || loading || !xAxisDomain}
                    showNavButtons={showNavButtons}
                  />
                );
              })}
            </Box>
          </Box>

          {chartMode === "all" && (
            <MachineSelectPanel
              machines={machines}
              selectedMachines={selectedMachines}
              setSelectedMachines={setSelectedMachines}
              toggleMachine={toggleMachine}
              machineIds={machineIds}
              machineColors={machineColors}
              colors={colors}
              fontFamily={fontFamily}
              onSaveSelectedMachines={saveSelectedMachinesToStorage}
            />
          )}
        </Box>

        {loading && (
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              zIndex: 9999,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              bgcolor: "rgba(15, 23, 42, 0.18)",
              pointerEvents: "auto",
            }}
          >
            <Paper
              elevation={0}
              sx={{
                px: 3,
                py: 2,
                borderRadius: 2.5,
                minWidth: 260,
                display: "flex",
                alignItems: "center",
                gap: 2,
                bgcolor: colors.white,
                border: `1px solid ${colors.border}`,
                boxShadow: "0 8px 24px rgba(15,23,42,0.12)",
              }}
            >
              <CircularProgress size={22} thickness={5} />

              <Box>
                <Typography
                  sx={{
                    fontFamily,
                    fontSize: 14,
                    fontWeight: 700,
                    color: colors.head,
                    lineHeight: 1.2,
                  }}
                >
                  Loading...
                </Typography>

                <Typography
                  sx={{
                    fontFamily,
                    fontSize: 12,
                    fontWeight: 700,
                    color: colors.subtle,
                    mt: 0.25,
                  }}
                >
                  Please wait while loading chart data
                </Typography>
              </Box>
            </Paper>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MachineSelectPanel({
  machines,
  selectedMachines,
  setSelectedMachines,
  toggleMachine,
  machineIds,
  machineColors,
  colors,
  fontFamily,
  onSaveSelectedMachines,
}) {
  const safeSelectedMachines = Array.isArray(selectedMachines)
    ? selectedMachines
    : [];

  const allSelectableIds = [OUTDOOR_CHART_ID, ...machineIds];

  const normalizeSelectionOrder = (ids) => {
    const uniqueIds = Array.from(new Set(Array.isArray(ids) ? ids : []));
    const hasOutdoor = uniqueIds.includes(OUTDOOR_CHART_ID);

    const numericIds = uniqueIds
      .filter((id) => id !== OUTDOOR_CHART_ID)
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id))
      .sort((a, b) => a - b);

    return hasOutdoor ? [OUTDOOR_CHART_ID, ...numericIds] : numericIds;
  };

  const saveAndSetSelectedMachines = (nextSelectedMachines) => {
    const normalizedSelectedMachines = normalizeSelectionOrder(
      nextSelectedMachines
    );

    setSelectedMachines(normalizedSelectedMachines);
    onSaveSelectedMachines?.(normalizedSelectedMachines);
  };

  const toggleOutdoor = () => {
    const current = Array.isArray(selectedMachines) ? selectedMachines : [];

    const nextSelectedMachines = current.includes(OUTDOOR_CHART_ID)
      ? current.filter((id) => id !== OUTDOOR_CHART_ID)
      : [OUTDOOR_CHART_ID, ...current];

    saveAndSetSelectedMachines(nextSelectedMachines);
  };

  return (
    <Paper
      elevation={0}
      sx={{
        p: 0,
        borderRadius: 3,
        border: `1px solid ${colors.border}`,
        bgcolor: colors.white,
        minHeight: 0,
        height: "100%",
        overflow: "hidden",
        boxSizing: "border-box",
        mt: 1,
      }}
    >
      <Box
        sx={{
          p: 2,
          pb: 1.25,
          bgcolor: colors.white,
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        <Typography
          sx={{
            fontFamily,
            fontSize: 16,
            fontWeight: 700,
            color: colors.head,
            mb: 1,
            lineHeight: 1.35,
          }}
        >
          Select machines to display
        </Typography>

        <Button
          fullWidth
          variant="contained"
          onClick={() => saveAndSetSelectedMachines(allSelectableIds)}
          sx={{
            height: 38,
            mb: 1,
            bgcolor: colors.head,
            fontSize: 14,
            fontWeight: 700,
            fontFamily,
            textTransform: "none",
            borderRadius: 2,
            boxShadow: "none",
            "&:hover": {
              bgcolor: "#000",
              boxShadow: "none",
            },
          }}
        >
          Select all {allSelectableIds.length} items
        </Button>

        <Button
          fullWidth
          variant="outlined"
          onClick={() => saveAndSetSelectedMachines([])}
          sx={{
            height: 38,
            color: colors.head,
            borderColor: colors.head,
            fontSize: 14,
            fontWeight: 700,
            fontFamily,
            textTransform: "none",
            borderRadius: 2,
            boxShadow: "none",
          }}
        >
          Clear selection
        </Button>
      </Box>

      <Box
        sx={{
          height: "calc(100% - 132px)",
          overflowY: "auto",
          overflowX: "hidden",
          p: 2,
          pt: 1.25,
          "&::-webkit-scrollbar": {
            width: 8,
          },
          "&::-webkit-scrollbar-track": {
            backgroundColor: "#f1f5f9",
            borderRadius: 99,
          },
          "&::-webkit-scrollbar-thumb": {
            backgroundColor: "#cbd5e1",
            borderRadius: 99,
          },
          "&::-webkit-scrollbar-thumb:hover": {
            backgroundColor: "#94a3b8",
          },
        }}
      >
        <FormControlLabel
          key={OUTDOOR_CHART_ID}
          sx={{
            width: "100%",
            m: 0,
            py: 0.35,
            alignItems: "center",
            "& .MuiFormControlLabel-label": {
              fontSize: 14.5,
              fontWeight: 700,
              minWidth: 0,
            },
          }}
          control={
            <Checkbox
              checked={safeSelectedMachines.includes(OUTDOOR_CHART_ID)}
              onChange={toggleOutdoor}
              sx={{
                color: OUTDOOR_CHART_COLOR,
                "&.Mui-checked": { color: OUTDOOR_CHART_COLOR },
              }}
            />
          }
          label={
            <Box
              component="span"
              sx={{
                color: OUTDOOR_CHART_COLOR,
                fontWeight: 700,
                whiteSpace: "nowrap",
              }}
              title={OUTDOOR_CHART_NAME}
            >
              {OUTDOOR_CHART_NAME}
            </Box>
          }
        />

        {machines.map((m) => {
          const machineDisplayName = getMachineDisplayName(m);

          return (
            <FormControlLabel
              key={m.id}
              sx={{
                width: "100%",
                m: 0,
                py: 0.35,
                alignItems: "center",
                "& .MuiFormControlLabel-label": {
                  fontSize: 14.5,
                fontWeight: 700,
                  minWidth: 0,
                },
              }}
              control={
                <Checkbox
                  checked={safeSelectedMachines.includes(m.id)}
                  onChange={() => {
                    const current = Array.isArray(selectedMachines)
                      ? selectedMachines
                      : [];

                    const nextSelectedMachines = current.includes(m.id)
                      ? current.filter((id) => id !== m.id)
                      : [...current, m.id];

                    saveAndSetSelectedMachines(nextSelectedMachines);
                  }}
                  sx={{
                    color: colors.head,
                    "&.Mui-checked": { color: colors.head },
                  }}
                />
              }
              label={
                <Box
                  component="span"
                  sx={{
                    color: machineColors[(m.id - 1) % machineColors.length],
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                  }}
                  title={machineDisplayName}
                >
                  {machineDisplayName}
                </Box>
              }
            />
          );
        })}
      </Box>
    </Paper>
  );
}

function ChartBox({
  chartKey,
  title,
  data,
  xAxisDomain,
  selectedMachines,
  isManualTimeWindow,
  disconnectedMachineIds,
  dataPrefix,
  machineColors,
  colors,
  fontFamily,
  axisSetting,
  timeRange,
  loading,
  machineNameMap,
  yZoomRange,
  thresholdSettingsByMachineId,
  onBack,
  onNext,
  onReset,
  navDisabled,
  showNavButtons,
}) {
  const safeData = Array.isArray(data) ? data : [];
  const safeSelectedMachines = Array.isArray(selectedMachines)
    ? selectedMachines
    : [];

  const plottableSelectedMachines = useMemo(() => {
    if (dataPrefix === "moldTemp") {
      return safeSelectedMachines.filter((id) => id !== OUTDOOR_CHART_ID);
    }

    return safeSelectedMachines;
  }, [dataPrefix, safeSelectedMachines]);

  const disconnectedCount = disconnectedMachineIds?.length || 0;
  const rowByTimeMap = useMemo(() => {
    const map = new Map();

    safeData.forEach((row) => {
      if (row.xTs) {
        map.set(row.xTs, row);
      }

      plottableSelectedMachines.forEach((id) => {
        const recordedAt = row[`recordedAt_${id}`];

        if (!recordedAt) return;

        const date = parseDbDateTime(recordedAt);

        if (!date) return;

        map.set(date.getTime(), row);
      });
    });

    return map;
  }, [safeData, plottableSelectedMachines]);
  const formatDateKey = useCallback((date) => {
    if (!date || Number.isNaN(date.getTime())) return "";

    const pad = (n) => String(n).padStart(2, "0");

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
      date.getDate()
    )}`;
  }, []);

  const shouldShowDateOnXAxis = useMemo(() => {
    if (!isManualTimeWindow || !xAxisDomain || xAxisDomain.length !== 2) {
      return false;
    }

    const startDate = new Date(xAxisDomain[0]);
    const endDate = new Date(xAxisDomain[1]);

    if (
      Number.isNaN(startDate.getTime()) ||
      Number.isNaN(endDate.getTime())
    ) {
      return false;
    }

    return formatDateKey(startDate) !== formatDateKey(endDate);
  }, [isManualTimeWindow, xAxisDomain, formatDateKey]);

  const formatChartTime = useCallback(
    (value) => {
      if (!value) return "";

      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "";

      const pad = (n) => String(n).padStart(2, "0");

      const timeText = `${pad(date.getHours())}:${pad(
        date.getMinutes()
      )}:${pad(date.getSeconds())}`;

      if (!shouldShowDateOnXAxis) {
        return timeText;
      }

      const dateText = `${pad(date.getDate())}/${pad(
        date.getMonth() + 1
      )}/${date.getFullYear()}`;

      return `${dateText} | ${timeText}`;
    },
    [shouldShowDateOnXAxis]
  );

  const yMin =
    yZoomRange && Number.isFinite(yZoomRange.min)
      ? yZoomRange.min
      : Number(axisSetting?.min ?? 0);

  const yMax =
    yZoomRange && Number.isFinite(yZoomRange.max)
      ? yZoomRange.max
      : Number(axisSetting?.max ?? 100);

  const yScale = Number(axisSetting?.scale ?? 10);
  const hasSelectedMachines = plottableSelectedMachines.length > 0;
  const machineColorMap = useMemo(() => {
    return plottableSelectedMachines.reduce((acc, id) => {
      acc[id] = getSeriesColor(id, machineColors);
      return acc;
    }, {});
  }, [plottableSelectedMachines, machineColors]);

  const thresholdMarkLines = useMemo(
    () =>
      buildThresholdMarkLines({
        chartKey,
        thresholdSettingsByMachineId,
        selectedMachineIds: plottableSelectedMachines,
        machineNameMap,
        machineColorMap,
      }),
    [
      chartKey,
      thresholdSettingsByMachineId,
      plottableSelectedMachines,
      machineNameMap,
      machineColorMap,
    ]
  );

  const thresholdValues = thresholdMarkLines
    .map((item) => Number(item.yAxis))
    .filter((value) => Number.isFinite(value));

  const finalYMin =
    thresholdValues.length > 0
      ? Math.min(yMin, ...thresholdValues)
      : yMin;

  const finalYMax =
    thresholdValues.length > 0
      ? Math.max(yMax, ...thresholdValues)
      : yMax;
  const option = useMemo(() => {
    const valueSeries = hasSelectedMachines
  ? plottableSelectedMachines.map((id) => {
      const color = getSeriesColor(id, machineColors);

      return {
        name: getSeriesName(id, machineNameMap),
        type: "line",
        disconnectedHelper: false,

        // dot
        showSymbol: false,
        showAllSymbol: false,
        symbol: "circle",
        symbolSize: 5,

        smooth: false,
        animation: false,
        connectNulls: false,
        sampling: "lttb",

        lineStyle: {
          width: 1.4,
          color,
          opacity: 0.65,
        },

        itemStyle: {
          color,
          opacity: 0.95,
        },

        emphasis: {
          focus: "none",
          scale: true,
          itemStyle: {
            opacity: 1,
          },
          lineStyle: {
            width: 2,
            opacity: 1,
          },
        },

        data: safeData
          .map((row) => {
            const value = row[`${dataPrefix}_${id}`];

            const recordedAt = row[`recordedAt_${id}`];
            const bucketTime = row.fullTime || row.realFullTime;

            const isDisconnected = Boolean(row[`isDisconnected_${id}`]);
            const xTime =
              value === null || value === undefined || isDisconnected
                ? bucketTime
                : recordedAt || bucketTime;

            const date = parseDbDateTime(xTime);

            if (!date) return null;

            return [
              date.getTime(),
              value === null || value === undefined ? null : value,
            ];
          })
          .filter((point) => point !== null),
      };
        })
  : [];


    const thresholdSeries =
      thresholdMarkLines.length > 0
        ? [
            {
              name: "Threshold",
              type: "line",
              data: [],
              silent: false,
              symbol: "none",
              lineStyle: {
                opacity: 0,
              },
              tooltip: {
                show: false,
              },
              markLine: {
                silent: false,
                triggerLineEvent: true,
                symbol: ["none", "none"],
                precision: 1,
                animation: false,
                label: {
                  show: true,
                  position: "start",
                  distance: 8,
                  fontSize: 10,
                  fontFamily,
                  fontWeight: 700,
                  align: "right",
                  verticalAlign: "middle",
                  backgroundColor: "transparent",
                  padding: 0,
                  borderRadius: 0,
                },
                emphasis: {
                  label: {
                    show: true,
                  },
                  lineStyle: {
                    width: 2,
                    opacity: 0.95,
                  },
                },
                tooltip: {
                  show: false,
                },
                data: thresholdMarkLines,
              },
            },
          ]
        : [];

  const series = [...valueSeries, ...thresholdSeries];

    return {
      animation: false,
      useUTC: false,
      backgroundColor: colors.white,
      grid: {
        top: 10,
        right: 18,
        bottom: shouldShowDateOnXAxis ? 44 : 36,
        left: 35,
        containLabel: false,
      },
      tooltip: {
        trigger: "axis",
        confine: true,
        transitionDuration: 0,
        backgroundColor: colors.white,
        borderColor: colors.border,
        borderWidth: 1,
        extraCssText:
          "border-radius:10px;box-shadow:0 8px 20px rgba(15,23,42,0.16);",
        axisPointer: {
          type: "none",
        },
        textStyle: {
          fontFamily,
          fontSize: 11,
          fontWeight: 700,
          color: colors.head,
        },
        formatter: (params) => {
            if (!Array.isArray(params) || params.length === 0) return "";

            const timeValue = params[0]?.value?.[0];
            const timeText = formatTooltipDateTime(timeValue);

            const currentRow = rowByTimeMap.get(timeValue);

            if (!currentRow) {
              return `Time: <b>${timeText}</b>`;
            }

            const rows = plottableSelectedMachines
              .map((id) => {
                const machineName = getSeriesName(id, machineNameMap);
                const value = currentRow[`${dataPrefix}_${id}`];
                const isDisconnected = Boolean(currentRow[`isDisconnected_${id}`]);
                const color = getSeriesColor(id, machineColors);

                const marker = `<span style="display:inline-block;margin-right:4px;border-radius:10px;width:10px;height:10px;background-color:${color};"></span>`;

                if (isDisconnected) {
                  return `${marker}${machineName}: <b>Disconnected</b>`;
                }

                if (value === null || value === undefined || value === "") {
                  return null;
                }

                return `${marker}${machineName}: <b>${value}</b>`;
              })
              .filter(Boolean)
              .join("<br/>");

            return `Time: <b>${timeText}</b>${rows ? `<br/>${rows}` : ""}`;
          },
      },
      graphic:
        xAxisDomain && xAxisDomain.length === 2
          ? [
              {
                type: "text",
                left: 8,
                bottom: 8,
                silent: true,
                style: {
                  text: formatChartTime(xAxisDomain[0]),
                  fill: colors.head,
                  font: `800 10px ${fontFamily}`,
                  textAlign: "left",
                },
              },
              {
                type: "text",
                right: 8,
                bottom: 8,
                silent: true,
                style: {
                  text: formatChartTime(xAxisDomain[1]),
                  fill: colors.head,
                  font: `800 10px ${fontFamily}`,
                  textAlign: "right",
                },
              },
            ]
          : [],
      xAxis: {
        type: "time",
        min: xAxisDomain?.[0],
        max: xAxisDomain?.[1],
        boundaryGap: false,
        axisLine: {
          show: true,
          lineStyle: {
            color: "#c4c4c4",
            width: 1,
          },
        },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: {
          show: false,
        },
      },
      yAxis: {
        type: "value",
        min: finalYMin,
        max: finalYMax,
        interval:
          Number.isFinite(yScale) && yScale > 0 ? yScale : undefined,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: {
          show: true,
          lineStyle: {
            type: "dashed",
            color: "#e2e8f0",
            width: 1,
            opacity: 0.75,
          },
        },
        axisLabel: {
          color: colors.head,
          fontFamily,
          fontSize: 10,
          fontWeight: 700,
          margin: 8,
        },
      },
      series,
    };
    }, [
    safeData,
    plottableSelectedMachines,
    machineColors,
    machineNameMap,
    dataPrefix,
    colors,
    fontFamily,
    xAxisDomain,
    yMin,
    yMax,
    finalYMin,
    finalYMax,
    yScale,
    formatChartTime,
    rowByTimeMap,
    hasSelectedMachines,
    thresholdMarkLines,
  ]);

  return (
    <Paper
      elevation={0}
      data-chart-key={
        dataPrefix === "moldTemp"
          ? "moldTemp"
          : dataPrefix === "temp"
          ? "envTemp"
          : "hum"
      }
      sx={{
        width: "100%",
        height: "100%",
        minWidth: 0,
        minHeight: 0,
        p: 0.75,
        borderRadius: 3,
        border: `1px solid ${colors.border}`,
        bgcolor: colors.white,
        overflow: "hidden",
        boxShadow: "0 3px 10px rgba(15,23,42,0.06)",
        position: "relative",
        cursor: "default",
        outline: "none !important",
      }}
    >
      <Typography
        sx={{
          height: 18,
          fontFamily,
          fontSize: 12.5,
          fontWeight: 800,
          color: colors.head,
          mb: 0.15,
          lineHeight: "18px",
          textAlign: "center",
        }}
      >
        {title}
      </Typography>

      {disconnectedCount > 0 && !loading && (
        <Box
          sx={{
            position: "absolute",
            top: 8,
            right: 10,
            zIndex: 2,
            px: 1,
            py: 0.35,
            borderRadius: 999,
            bgcolor: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#991b1b",
            fontSize: 10.5,
            fontWeight: 800,
            fontFamily,
            pointerEvents: "none",
          }}
        >
          Disconnected: {disconnectedCount} machines
        </Box>
      )}

      {safeData.length === 0 && !loading && (
        <Typography
          sx={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: colors.subtle,
            fontSize: 13,
            fontWeight: 700,
            pointerEvents: "none",
            zIndex: 2,
          }}
        >
          No chart data
        </Typography>
      )}

      {showNavButtons && (
        <Box sx={chartNavGroupSx}>
          <Button
            disabled={navDisabled}
            onClick={(e) => {
              e.stopPropagation();
              onBack?.();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            sx={chartNavButtonSx(colors, fontFamily)}
          >
            {"<"}
          </Button>

          <Button
            disabled={loading}
            onClick={(e) => {
              e.stopPropagation();
              onReset?.();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            sx={chartResetButtonSx(colors, fontFamily)}
          >
            Reset
          </Button>

          <Button
            disabled={navDisabled}
            onClick={(e) => {
              e.stopPropagation();
              onNext?.();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            sx={chartNavButtonSx(colors, fontFamily)}
          >
            {">"}
          </Button>
        </Box>
      )}

      <Box
        sx={{
          width: "100%",
          height: "calc(100% - 22px)",
          minWidth: 0,
          minHeight: 0,
        }}
      >
        <EChartsCanvas
          option={option}
          style={{
            width: "100%",
            height: "100%",
          }}
        />
      </Box>
    </Paper>
  );
}

function EChartsCanvas({ option, style }) {
  const wrapperRef = useRef(null);
  const domRef = useRef(null);
  const chartRef = useRef(null);
  const resizeObserverRef = useRef(null);
  const [thresholdTooltip, setThresholdTooltip] = useState(null);

  const thresholdLines = useMemo(() => {
    if (!option || !Array.isArray(option.series)) return [];

    const lines = [];

    option.series.forEach((seriesItem, seriesIndex) => {
      const data = seriesItem?.markLine?.data;
      if (!Array.isArray(data)) return;

      data.forEach((lineItem, dataIndex) => {
        const yValue = Number(lineItem?.yAxis);
        if (!Number.isFinite(yValue) || !lineItem?.thresholdMeta) return;

        lines.push({
          ...lineItem,
          yValue,
          seriesIndex,
          dataIndex,
        });
      });
    });

    return lines;
  }, [option]);

  useEffect(() => {
    if (!domRef.current) return undefined;

    chartRef.current = echarts.init(domRef.current, null, {
      renderer: "canvas",
    });

    const handleResize = () => {
      chartRef.current?.resize();
    };

    window.addEventListener("resize", handleResize);

    if (typeof ResizeObserver !== "undefined") {
      resizeObserverRef.current = new ResizeObserver(() => {
        window.requestAnimationFrame(() => {
          chartRef.current?.resize();
        });
      });

      resizeObserverRef.current.observe(domRef.current);
    }

    window.requestAnimationFrame(() => {
      chartRef.current?.resize();
    });

    return () => {
      window.removeEventListener("resize", handleResize);

      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }

      if (chartRef.current) {
        chartRef.current.clear();
        chartRef.current.dispose();
        chartRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!chartRef.current || !option) return;

    chartRef.current.setOption(option, true);

    window.requestAnimationFrame(() => {
      chartRef.current?.resize();
    });
  }, [option]);

  useEffect(() => {
    const chart = chartRef.current;
    const wrapper = wrapperRef.current;

    if (!chart || !wrapper || thresholdLines.length === 0) {
      setThresholdTooltip(null);
      return undefined;
    }

    const hideThresholdTooltip = () => {
      setThresholdTooltip(null);
    };

    const showThresholdTooltip = (event) => {
      const offsetX = Number(event?.offsetX);
      const offsetY = Number(event?.offsetY);

      if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) {
        hideThresholdTooltip();
        return;
      }

      const point = [offsetX, offsetY];

      if (!chart.containPixel({ gridIndex: 0 }, point)) {
        hideThresholdTooltip();
        return;
      }

      const matchedLines = thresholdLines.filter((line) => {
        const yPixel = chart.convertToPixel({ yAxisIndex: 0 }, line.yValue);

        return Number.isFinite(yPixel) && Math.abs(yPixel - offsetY) <= 6;
      });

      if (matchedLines.length === 0) {
        hideThresholdTooltip();
        return;
      }

      chart.dispatchAction({ type: "hideTip" });

      const wrapperRect = wrapper.getBoundingClientRect();
      const tooltipWidth = 320;

      const matchedMetaCount = matchedLines.reduce((total, line) => {
        if (Array.isArray(line.thresholdMeta)) {
          return total + line.thresholdMeta.length;
        }

        return total + 1;
      }, 0);

      const tooltipHeight = 42 + matchedMetaCount * 24;

      setThresholdTooltip({
        left: Math.min(offsetX + 12, Math.max(8, wrapperRect.width - tooltipWidth - 8)),
        top: Math.min(offsetY + 12, Math.max(8, wrapperRect.height - tooltipHeight - 8)),
        html: formatThresholdTooltip(
          matchedLines.flatMap((line) =>
            Array.isArray(line.thresholdMeta)
              ? line.thresholdMeta
              : [line.thresholdMeta]
          )
        ),
      });
    };

    const zr = chart.getZr();

    zr.on("mousemove", showThresholdTooltip);
    zr.on("click", showThresholdTooltip);
    zr.on("globalout", hideThresholdTooltip);

    return () => {
      zr.off("mousemove", showThresholdTooltip);
      zr.off("click", showThresholdTooltip);
      zr.off("globalout", hideThresholdTooltip);
    };
  }, [thresholdLines]);

  return (
    <div
      ref={wrapperRef}
      style={{
        ...style,
        position: "relative",
      }}
    >
      <div
        ref={domRef}
        style={{
          width: "100%",
          height: "100%",
        }}
      />

      {thresholdTooltip && (
        <div
          style={{
            position: "absolute",
            left: thresholdTooltip.left,
            top: thresholdTooltip.top,
            zIndex: 30,
            maxWidth: 320,
            overflow: "visible",
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid #d1d5db",
            background: "#fff",
            boxShadow: "0 8px 20px rgba(15,23,42,0.16)",
            color: "#111827",
            fontFamily: "inherit",
            fontSize: 11,
            fontWeight: 700,
            lineHeight: 1.45,
            pointerEvents: "none",
          }}
          dangerouslySetInnerHTML={{ __html: thresholdTooltip.html }}
        />
      )}
    </div>
  );
}

const chartNavGroupSx = {
  position: "absolute",
  bottom: 8,
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 20,
  display: "flex",
  alignItems: "center",
  gap: 0.5,
  px: 0.5,
  py: 0.4,
  boxShadow: "0 2px 8px rgba(15,23,42,0.12)",
};

function chartNavButtonSx(colors, fontFamily) {
  return {
    minWidth: 25,
    height: 25,
    px: 0,
    pt:1,
    borderRadius: 1.4,
    fontFamily,
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1,
    textTransform: "none",
    color: colors.head,
    bgcolor: colors.white,
    border: `1px solid ${colors.border}`,
    boxShadow: "none",
    "&:hover": {
      bgcolor: "#38bdf8",
      color: "#000",
      borderColor: "#0284c7",
      boxShadow: "none",
    },
    "&.Mui-disabled": {
      bgcolor: "rgba(241,245,249,0.9)",
      color: "#94a3b8",
      borderColor: colors.border,
    },
  };
}

function chartResetButtonSx(colors, fontFamily) {
  return {
    minWidth: 54,
    height: 25,
    px: 1,
    py: 0,
    borderRadius: 1.4,
    fontFamily,
    fontSize: 11,
    fontWeight: 900,
    lineHeight: 1,
    textTransform: "none",
    color: colors.head,
    bgcolor: colors.white,
    border: `1px solid ${colors.border}`,
    boxShadow: "none",
    "&:hover": {
      bgcolor: "#000000",
      borderColor: "#000000",
      color: "#fff",
      boxShadow: "none",
    },
    "&.Mui-disabled": {
      bgcolor: "rgba(241,245,249,0.9)",
      color: "#94a3b8",
      borderColor: colors.border,
    },
  };
}