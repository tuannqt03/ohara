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
const DEFAULT_SAMPLE_TIME = 10;
const DISCONNECTED_LIMIT_SECONDS = 20;
const DEFAULT_TIME_OPTIONS = [
  { value: 10, label: "10s" },
  { value: 30, label: "30s" },
  { value: 60, label: "60s" },
];

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

    const selectedStartTime = parseSavedDate(parsed.selectedStartTime);
    const selectedEndTime = parseSavedDate(parsed.selectedEndTime);
    const hasValidRange =
      selectedStartTime && selectedEndTime && selectedStartTime < selectedEndTime;

    return {
      visibleCharts:
        visibleCharts && visibleCharts.length > 0 ? visibleCharts : null,
      timeRange: Number(parsed.timeRange) || null,
      selectedStartTime: hasValidRange ? selectedStartTime : null,
      selectedEndTime: hasValidRange ? selectedEndTime : null,
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

  return machine.code ? `${machine.name}_${machine.code}` : machine.name;
};
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
}) {
  const savedChartState = useMemo(() => loadSavedChartState(), []);

  const [visibleCharts, setVisibleCharts] = useState(
    Array.isArray(savedChartState.visibleCharts)
      ? savedChartState.visibleCharts
      : DEFAULT_VISIBLE_CHARTS
  );

  const [timeRange, setTimeRange] = useState(savedChartState.timeRange || 10);
  const [timeOptions, setTimeOptions] = useState(DEFAULT_TIME_OPTIONS);

  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [chartInitialized, setChartInitialized] = useState(false);

  const [lastRefreshAt, setLastRefreshAt] = useState(null);
  const [latestMachineMap, setLatestMachineMap] = useState({});

  const [selectedStartTime, setSelectedStartTime] = useState(
    savedChartState.selectedStartTime || null
  );
  const [selectedEndTime, setSelectedEndTime] = useState(
    savedChartState.selectedEndTime || null
  );

  const [realtimeMode, setRealtimeMode] = useState(
    !(savedChartState.selectedStartTime && savedChartState.selectedEndTime)
  );
  const [settingOpen, setSettingOpen] = useState(false);
  const [xAxisDomain, setXAxisDomain] = useState(null);
  const [yZoomRange, setYZoomRange] = useState(null);

  const [chartAxisSettings, setChartAxisSettings] = useState(
    savedChartState.chartAxisSettings || DEFAULT_CHART_AXIS_SETTINGS
  );

  const machineNameMap = useMemo(() => {
    return machines.reduce((acc, machine) => {
      acc[machine.id] = getMachineDisplayName(machine);
      return acc;
    }, {});
  }, [machines]);

  const noDataLimitSeconds = DISCONNECTED_LIMIT_SECONDS;

  useEffect(() => {
    if (!open) return;

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
          // Khi Apply Start/End: giữ đúng khoảng user chọn
          domainStartMs = startTime.getTime();
          domainEndMs = endTime.getTime();
        } else {
          // Realtime: lấy mốc dữ liệu mới nhất trong DB rồi lùi 100 step
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

        // Với realtime / nút lùi / nút tiến: cho trục X bám sát điểm dữ liệu thật
        // để line không bị hở một đoạn so với trục Y.
        if (!isManualTimeWindow && nextHistory.length > 0) {
          finalStartMs = nextHistory[0].xTs;
          finalEndMs = nextHistory[nextHistory.length - 1].xTs;
        }

        // Với nút lùi/tiến vẫn ép sát dữ liệu thật như cũ.
        if (fitDataDomain && nextHistory.length > 0) {
          finalStartMs = nextHistory[0].xTs;
          finalEndMs = nextHistory[nextHistory.length - 1].xTs;
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
    [loadLatestMachines, selectedStartTime, selectedEndTime]
  );

  useEffect(() => {
    if (!open) {
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
          setSelectedStartTime(savedStartTime);
          setSelectedEndTime(savedEndTime);
          setRealtimeMode(false);

          await loadChartData(nextTimeRange, true, savedStartTime, savedEndTime);
        } else {
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

    // Chỉ realtime mới tự reload theo sample step 10s/30s/60s
    if (!realtimeMode) {
      return;
    }

    const safeTimeRange = Number(timeRange) || DEFAULT_SAMPLE_TIME;
    const reloadMs = safeTimeRange * 1000;

    const timer = window.setInterval(() => {
      loadChartData(safeTimeRange, false, null, null);
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
      if (!xAxisDomain || xAxisDomain.length !== 2 || loading) return;

      const [currentStartMs, currentEndMs] = xAxisDomain;
      const windowMs = currentEndMs - currentStartMs;

      if (windowMs <= 0) return;

      const moveMs = Number(timeRange || 10) * DEFAULT_VISIBLE_POINTS * 1000;

      let nextStartMs = currentStartMs;
      let nextEndMs = currentEndMs;

      if (direction === "back") {
        nextStartMs = currentStartMs - moveMs;
        nextEndMs = currentEndMs - moveMs;

        const nextStart = new Date(nextStartMs);
        const nextEnd = new Date(nextEndMs);

        setRealtimeMode(false);
        setSelectedStartTime(nextStart);
        setSelectedEndTime(nextEnd);

        await loadChartData(timeRange, true, nextStart, nextEnd, true);
        return;
      }

      nextStartMs = currentStartMs + moveMs;
      nextEndMs = currentEndMs + moveMs;

      const nowMs = Date.now();

      if (nextEndMs >= nowMs) {
        setRealtimeMode(true);
        setSelectedStartTime(null);
        setSelectedEndTime(null);

        await loadChartData(timeRange, true, null, null);
        return;
      }

      const nextStart = new Date(nextStartMs);
      const nextEnd = new Date(nextEndMs);

      setRealtimeMode(false);
      setSelectedStartTime(nextStart);
      setSelectedEndTime(nextEnd);

      await loadChartData(timeRange, true, nextStart, nextEnd, true);
    },
    [xAxisDomain, loading, timeRange, loadChartData]
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
    async (startDateValue, startTimeValue, endDateValue, endTimeValue) => {
      const nextStartTime = combineDateAndTimeInput(
        startDateValue,
        startTimeValue
      );
      const nextEndTime = combineDateAndTimeInput(endDateValue, endTimeValue);

      if (!nextStartTime || !nextEndTime) {
        alert("Vui lòng chọn đủ ngày giờ bắt đầu và kết thúc");
        return;
      }

      if (nextStartTime >= nextEndTime) {
        alert("Thời gian bắt đầu phải nhỏ hơn thời gian kết thúc");
        return;
      }

      setRealtimeMode(false);
      setSelectedStartTime(nextStartTime);
      setSelectedEndTime(nextEndTime);

      await loadChartData(timeRange, true, nextStartTime, nextEndTime);
    },
    [loadChartData, timeRange]
  );

  const title =
  chartMode === "single"
    ? `CHART ${
        getMachineDisplayName(
          machines.find((m) => m.id === selectedMachines[0])
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

      if (action === "apply") {
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

      setRealtimeMode(true);
      setSelectedStartTime(null);
      setSelectedEndTime(null);

      await loadChartData(timeRange, true, null, null);
    },
    [loadChartData, timeRange, selectedStartTime, selectedEndTime]
  );

  const resetToRealtime = useCallback(
    async (nextTimeRange = DEFAULT_SAMPLE_TIME) => {
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
            chartAxisSettings,
          })
        );
      } catch (error) {
        console.warn("Failed to reset saved chart state:", error);
      }

      await loadChartData(nextTimeRange, true, null, null);
    },
    [loadChartData, visibleCharts, chartAxisSettings]
  );
const handleDialogClose = useCallback(() => {
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
        chartAxisSettings,
      })
    );
  } catch (error) {
    console.warn("Failed to reset saved chart state:", error);
  }

  onClose?.();
}, [onClose, visibleCharts, chartAxisSettings]);

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
            fontWeight: 900,
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
                setTimeRange(nextTimeRange);

                if (selectedStartTime && selectedEndTime) {
                  setRealtimeMode(false);

                  await loadChartData(
                    nextTimeRange,
                    true,
                    selectedStartTime,
                    selectedEndTime
                  );

                  return;
                }

                await resetToRealtime(nextTimeRange);
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
                    fontWeight: 800,
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
                    fontWeight: 800,
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
}) {
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
          onClick={() => setSelectedMachines(machineIds)}
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
          Select all {machineIds.length} machines
        </Button>

        <Button
          fullWidth
          variant="outlined"
          onClick={() => setSelectedMachines([])}
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
                  checked={selectedMachines.includes(m.id)}
                  onChange={() => toggleMachine(m.id)}
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

  const disconnectedCount = disconnectedMachineIds?.length || 0;

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

  const option = useMemo(() => {
    const series = safeSelectedMachines.map((id) => {
      const color = machineColors[(id - 1) % machineColors.length];

      return {
        name: machineNameMap?.[id] || `Machine ${id}`,
        type: "line",

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

        data: safeData.map((row) => [
          row.xTs,
          row[`${dataPrefix}_${id}`] ?? null,
        ]),
      };
    });

    return {
      animation: false,
      useUTC: false,
      backgroundColor: colors.white,
      grid: {
        top: 10,
        right: 18,
        bottom: shouldShowDateOnXAxis ? 44 : 36,
        left: 18,
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
          type: "line",
          snap: true,
          lineStyle: {
            type: "dashed",
            width: 1,
            color: "#64748b",
          },
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
          const time = new Date(timeValue);
          const pad = (n) => String(n).padStart(2, "0");
          const timeText = Number.isNaN(time.getTime())
            ? ""
            : `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(
                time.getDate()
              )} ${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(
                time.getSeconds()
              )}`;

          const rows = params
            .filter(
              (p) =>
                p.value?.[1] !== null &&
                p.value?.[1] !== undefined &&
                p.value?.[1] !== ""
            )
            .map((p) => `${p.marker}${p.seriesName}: <b>${p.value[1]}</b>`)
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
            color: "#111827",
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
        min: yMin,
        max: yMax,
        interval:
          Number.isFinite(yScale) && yScale > 0 ? yScale : undefined,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: {
          show: true,
          lineStyle: {
            type: "dashed",
            color: "#cbd5e1",
          },
        },
        axisLabel: {
          color: colors.head,
          fontFamily,
          fontSize: 10,
          fontWeight: 800,
        },
      },
      series,
    };
  }, [
    safeData,
    safeSelectedMachines,
    machineColors,
    machineNameMap,
    dataPrefix,
    colors,
    fontFamily,
    xAxisDomain,
    yMin,
    yMax,
    yScale,
    formatChartTime,
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
  const domRef = useRef(null);
  const chartRef = useRef(null);
  const resizeObserverRef = useRef(null);

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

  return <div ref={domRef} style={style} />;
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
    fontWeight: 900,
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