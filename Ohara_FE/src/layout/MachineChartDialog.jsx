import React, { useCallback, useEffect, useMemo, useState } from "react";
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
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";

import { temperatureHumidityApi } from "../config/api";
import ChartToolbar, { CHART_OPTIONS } from "./ChartToolbar";

const DEFAULT_TIME_OPTIONS = [
  { value: 10, label: "10s" },
  { value: 30, label: "30s" },
  { value: 60, label: "60s" },
  { value: 300, label: "5m" },
  { value: 600, label: "10m" },
];

const DEFAULT_VISIBLE_POINTS = 100;
const CHART_BUFFER_POINTS = 2000;
const WHEEL_STEP_POINTS = 100;
const DRAG_STEP_RATIO = 0.7;
const NO_DATA_LIMIT_MULTIPLIER = 3;

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
  const [visibleCharts, setVisibleCharts] = useState([
    "moldTemp",
    "envTemp",
    "hum",
  ]);

  const [timeRange, setTimeRange] = useState(10);
  const [timeOptions, setTimeOptions] = useState(DEFAULT_TIME_OPTIONS);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [chartInitialized, setChartInitialized] = useState(false);
  const [yZoomRange, setYZoomRange] = useState(null);
  const [lastRefreshAt, setLastRefreshAt] = useState(null);
  const [latestMachineMap, setLatestMachineMap] = useState({});

  // null = realtime latest window
  // Date = history mode / custom range mode
  const [selectedEndTime, setSelectedEndTime] = useState(null);
  const [selectedStartTime, setSelectedStartTime] = useState(null);
  const [zoomRange, setZoomRange] = useState(null);
  const [dragState, setDragState] = useState(null);

  const [chartAxisSettings, setChartAxisSettings] = useState({
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
  });

  const machineNameMap = useMemo(() => {
    return machines.reduce((acc, machine) => {
      acc[machine.id] = machine.name;
      return acc;
    }, {});
  }, [machines]);

  const noDataLimitSeconds = Math.max(
    Number(timeRange || 10) * NO_DATA_LIMIT_MULTIPLIER,
    30
  );

  const getWindowMs = useCallback(
    (interval = timeRange) => {
      return Number(interval || 10) * DEFAULT_VISIBLE_POINTS * 1000;
    },
    [timeRange]
  );

  const formatApiDateTime = (date) => {
    if (!date) return "";

    const pad = (n) => String(n).padStart(2, "0");

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
      date.getDate()
    )} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
      date.getSeconds()
    )}`;
  };

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
      endTimeValue = selectedEndTime
    ) => {
      try {
        if (showLoading) {
          setLoading(true);
        }

        const startTime = startTimeValue ? new Date(startTimeValue) : null;
        const endTime = endTimeValue ? new Date(endTimeValue) : null;
        const isCustomRange = Boolean(startTime || endTime);

        const [chartRes] = await Promise.all([
          temperatureHumidityApi.getChartData({
            interval,
            points: CHART_BUFFER_POINTS,
            ...(startTime ? { startTime: formatApiDateTime(startTime) } : {}),
            ...(endTime ? { endTime: formatApiDateTime(endTime) } : {}),
          }),
          loadLatestMachines(),
        ]);

        const nextHistory = Array.isArray(chartRes.data) ? chartRes.data : [];
        setHistory(nextHistory);

        if (showLoading) {
          const total = nextHistory.length;

          if (isCustomRange) {
            // Chọn From/To thì hiển thị toàn bộ khoảng đã chọn
            setZoomRange({
              startIndex: 0,
              endIndex: Math.max(0, total - 1),
            });
          } else {
            // Realtime/manual thường thì chỉ hiện 100 điểm cuối
            const visibleCount = Math.min(DEFAULT_VISIBLE_POINTS, total);

            setZoomRange(
              total > visibleCount
                ? {
                    startIndex: total - visibleCount,
                    endIndex: total - 1,
                  }
                : {
                    startIndex: 0,
                    endIndex: Math.max(0, total - 1),
                  }
            );
          }

          setYZoomRange(null);
        }

        setLastRefreshAt(endTime || new Date());
      } catch (error) {
        console.error("Failed to load chart data:", error);
        setHistory([]);
        setZoomRange({
          startIndex: 0,
          endIndex: 0,
        });
        setLastRefreshAt(endTimeValue ? new Date(endTimeValue) : new Date());
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
      setSelectedEndTime(null);
      setSelectedStartTime(null);
      setZoomRange(null);
      setYZoomRange(null);
      setDragState(null);
      return;
    }

    if (chartInitialized) return;

    const initChart = async () => {
      try {
        setLoading(true);

        setVisibleCharts(CHART_OPTIONS.map((x) => x.value));

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

        setTimeOptions(nextTimeOptions);
        setTimeRange(nextTimeRange);
        setSelectedEndTime(null);
        setSelectedStartTime(null);

        await loadChartData(nextTimeRange, true, null, null);

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
    if (!open || !chartInitialized || selectedEndTime) return;

    const reloadMs = Math.max(Number(timeRange || 10), 5) * 1000;

    const timer = window.setInterval(() => {
      loadChartData(timeRange, false, null, null);
    }, reloadMs);

    return () => {
      window.clearInterval(timer);
    };
  }, [open, chartInitialized, timeRange, selectedEndTime, loadChartData]);

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

      return diffSeconds > noDataLimitSeconds;
    });
  }, [selectedMachines, latestMachineMap, lastRefreshAt, noDataLimitSeconds]);

  const filteredHistory = useMemo(() => {
    return Array.isArray(history) ? history : [];
  }, [history]);

  const visibleHistory = useMemo(() => {
    if (!zoomRange || filteredHistory.length === 0) {
      return filteredHistory;
    }

    const start = Math.max(0, zoomRange.startIndex);
    const end = Math.min(filteredHistory.length - 1, zoomRange.endIndex);

    return filteredHistory.slice(start, end + 1);
  }, [filteredHistory, zoomRange]);

  const shiftZoomWindow = useCallback(
    (direction) => {
      if (!filteredHistory || filteredHistory.length === 0) return;

      const total = filteredHistory.length;
      const currentStart = zoomRange?.startIndex ?? Math.max(0, total - DEFAULT_VISIBLE_POINTS);
      const currentEnd = zoomRange?.endIndex ?? total - 1;
      const size = currentEnd - currentStart + 1;

      const move = WHEEL_STEP_POINTS;
      let nextStart =
        direction === "back" ? currentStart - move : currentStart + move;

      nextStart = Math.max(0, Math.min(total - size, nextStart));

      setZoomRange({
        startIndex: nextStart,
        endIndex: nextStart + size - 1,
      });
    },
    [filteredHistory, zoomRange]
  );

  const handleChartDragStart = useCallback(
    (event) => {
      if (!filteredHistory || filteredHistory.length === 0) return;

      const chartKey = event.currentTarget.dataset.chartKey;
      const setting = chartAxisSettings[chartKey];

      const baseMin = Number(setting?.min ?? 0);
      const baseMax = Number(setting?.max ?? 100);

      setDragState({
        startClientX: event.clientX,
        startClientY: event.clientY,
        startZoomRange:
          zoomRange ||
          {
            startIndex: Math.max(0, filteredHistory.length - DEFAULT_VISIBLE_POINTS),
            endIndex: Math.max(0, filteredHistory.length - 1),
          },
        chartKey,
        startYRange:
          yZoomRange?.[chartKey] || {
            min: baseMin,
            max: baseMax,
          },
      });
    },
    [filteredHistory, zoomRange, yZoomRange, chartAxisSettings]
  );

  const handleChartDragMove = useCallback(
    (event) => {
      if (!dragState || !filteredHistory || filteredHistory.length === 0) return;

      if (event.buttons !== 1) {
        setDragState(null);
        return;
      }

      const total = filteredHistory.length;
      const size =
        dragState.startZoomRange.endIndex - dragState.startZoomRange.startIndex + 1;

      const rect = event.currentTarget.getBoundingClientRect();
      const deltaX = event.clientX - dragState.startClientX;
      const deltaY = event.clientY - dragState.startClientY;

      // Kéo ngang: pan time.
      const pointsPerPixel = size / Math.max(1, rect.width);
      const pointShift = Math.round(-deltaX * pointsPerPixel);

      let nextStart = dragState.startZoomRange.startIndex + pointShift;
      nextStart = Math.max(0, Math.min(total - size, nextStart));

      setZoomRange({
        startIndex: nextStart,
        endIndex: nextStart + size - 1,
      });

      // Kéo dọc: pan Y trong phạm vi Min/Max setting.
      const setting = chartAxisSettings[dragState.chartKey];
      const baseMin = Number(setting?.min ?? 0);
      const baseMax = Number(setting?.max ?? 100);

      const startY = dragState.startYRange;
      const yWindow = startY.max - startY.min;
      const baseRange = baseMax - baseMin;

      if (
        Number.isFinite(baseMin) &&
        Number.isFinite(baseMax) &&
        baseRange > 0 &&
        yWindow > 0 &&
        yWindow < baseRange
      ) {
        const valuePerPixel = yWindow / Math.max(1, rect.height);
        const yShift = deltaY * valuePerPixel * DRAG_STEP_RATIO;

        let nextMin = startY.min + yShift;
        let nextMax = startY.max + yShift;

        if (nextMin < baseMin) {
          nextMin = baseMin;
          nextMax = baseMin + yWindow;
        }

        if (nextMax > baseMax) {
          nextMax = baseMax;
          nextMin = baseMax - yWindow;
        }

        setYZoomRange((prev) => ({
          ...prev,
          [dragState.chartKey]: {
            min: Number(nextMin.toFixed(2)),
            max: Number(nextMax.toFixed(2)),
          },
        }));
      }
    },
    [dragState, filteredHistory, chartAxisSettings]
  );

  const handleChartDragEnd = useCallback(() => {
    setDragState(null);
  }, []);

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
      .filter((item) => visibleCharts.includes(item.key))
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
    const nextStartTime = combineDateAndTimeInput(startDateValue, startTimeValue);
    const nextEndTime = combineDateAndTimeInput(endDateValue, endTimeValue);

    console.log("APPLY RANGE:", {
      startDateValue,
      startTimeValue,
      endDateValue,
      endTimeValue,
      nextStartTime,
      nextEndTime,
    });

    if (!nextStartTime || !nextEndTime) {
      alert("Vui lòng chọn đủ ngày giờ bắt đầu và kết thúc");
      return;
    }

    if (nextStartTime >= nextEndTime) {
      alert("Thời gian bắt đầu phải nhỏ hơn thời gian kết thúc");
      return;
    }

    setSelectedStartTime(nextStartTime);
    setSelectedEndTime(nextEndTime);

    await loadChartData(timeRange, true, nextStartTime, nextEndTime);
  },
  [loadChartData, timeRange]
);

  const title =
    chartMode === "single"
      ? `CHART ${
          machines.find((m) => m.id === selectedMachines[0])?.name || ""
        }`
      : "CHART TEMPERATURE & HUMIDITY";

  return (
    <Dialog
      open={open}
      onClose={onClose}
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

        <IconButton onClick={onClose} sx={{ color: colors.white }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent
        sx={{
          bgcolor: colors.bg,
          p: 2,
          height: "calc(100vh - 64px)",
          overflow: "hidden",
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
              visibleCharts={visibleCharts}
              setVisibleCharts={setVisibleCharts}
              chartAxisSettings={chartAxisSettings}
              setChartAxisSettings={setChartAxisSettings}
              selectedStartTime={selectedStartTime}
              onDateTimeRangeChange={handleDateTimeRangeChange}
              timeRange={timeRange}
              setTimeRange={setTimeRange}
              onTimeRangeChange={async (nextTimeRange) => {
                setTimeRange(nextTimeRange);
                await loadChartData(
                  nextTimeRange,
                  true,
                  selectedStartTime,
                  selectedEndTime
                );
              }}
              timeOptions={timeOptions}
              loading={loading}
              selectedEndTime={selectedEndTime}
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
                    selectedMachines={selectedMachines}
                    disconnectedMachineIds={disconnectedMachineIds}
                    noDataLimitSeconds={noDataLimitSeconds}
                    dataPrefix={chart.dataPrefix}
                    machineColors={machineColors}
                    colors={colors}
                    fontFamily={fontFamily}
                    axisSetting={chart.axisSetting}
                    timeRange={timeRange}
                    loading={loading}
                    machineNameMap={machineNameMap}
                    isDragging={Boolean(dragState)}
                    onDragStart={handleChartDragStart}
                    onDragMove={handleChartDragMove}
                    onDragEnd={handleChartDragEnd}
                    yZoomRange={yZoomRange?.[chart.key]}
                    onBack={showNavButtons ? () => shiftZoomWindow("back") : undefined}
                    onNext={showNavButtons ? () => shiftZoomWindow("next") : undefined}
                    navDisabled={
                      !showNavButtons || loading || filteredHistory.length === 0
                    }
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
        {machines.map((m) => (
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
                title={m.name}
              >
                {m.name}
              </Box>
            }
          />
        ))}
      </Box>
    </Paper>
  );
}

function ChartBox({
  title,
  data,
  selectedMachines,
  disconnectedMachineIds,
  dataPrefix,
  machineColors,
  colors,
  fontFamily,
  axisSetting,
  timeRange,
  loading,
  machineNameMap,
  onDragStart,
  onDragMove,
  onDragEnd,
  yZoomRange,
  onBack,
  onNext,
  navDisabled,
  showNavButtons,
  isDragging,
}) {
  const xAxisTicks =
    data && data.length > 1 ? [data[0].time, data[data.length - 1].time] : [];

  const yAxisTicks = useMemo(() => {
    const min = Number(axisSetting?.min ?? 0);
    const max = Number(axisSetting?.max ?? 100);
    const scale = Number(axisSetting?.scale ?? 10);

    if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(scale)) {
      return undefined;
    }

    if (scale <= 0 || max <= min) {
      return undefined;
    }

    const ticks = [];
    for (let value = min; value <= max; value += scale) {
      ticks.push(Number(value.toFixed(6)));
    }

    if (ticks[ticks.length - 1] !== max) {
      ticks.push(max);
    }

    return ticks;
  }, [axisSetting]);

  const yAxisDomain = useMemo(() => {
    if (
      yZoomRange &&
      Number.isFinite(yZoomRange.min) &&
      Number.isFinite(yZoomRange.max)
    ) {
      return [yZoomRange.min, yZoomRange.max];
    }

    return [
      Number(axisSetting?.min ?? 0),
      Number(axisSetting?.max ?? 100),
    ];
  }, [axisSetting, yZoomRange]);

  const disconnectedCount = disconnectedMachineIds?.length || 0;

  const isAllSelectedDisconnected =
    selectedMachines.length > 0 &&
    selectedMachines.every((id) => disconnectedMachineIds.includes(id));

  return (
    <Paper
      elevation={0}
      onMouseDown={onDragStart}
      onMouseMove={onDragMove}
      onMouseUp={onDragEnd}
      onMouseLeave={onDragEnd}
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
        cursor: isDragging ? "grabbing" : "grab",
        userSelect: "none",
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

      {data.length === 0 && !loading && (
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
          }}
        >
          No chart data
        </Typography>
      )}

      {isAllSelectedDisconnected && !loading && data.length > 0 && (
        <Typography
          sx={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#991b1b",
            fontSize: 13,
            fontWeight: 800,
            pointerEvents: "none",
            zIndex: 1,
            textAlign: "center",
            px: 2,
          }}
        >
          Selected machines have no new data. Please check the PLC / gateway
          connection.
        </Typography>
      )}
      {showNavButtons && (
        <>
          <Button
            disabled={navDisabled}
            onClick={(e) => {
              e.stopPropagation();
              onBack?.();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            sx={chartSideNavButtonSx(colors, fontFamily, "left")}
          >
            {"<"}
          </Button>

          <Button
            disabled={navDisabled}
            onClick={(e) => {
              e.stopPropagation();
              onNext?.();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            sx={chartSideNavButtonSx(colors, fontFamily, "right")}
          >
            {">"}
          </Button>
        </>
      )}
      <Box
        sx={{
          width: "100%",
          height: "calc(100% - 19px)",
          minWidth: 0,
          minHeight: 0,
        }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{
              top: 2,
              right: 20,
              left: -10,
              bottom: 1,
            }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" />

            <XAxis
              dataKey="time"
              ticks={xAxisTicks}
              interval={0}
              padding={{ left: 0, right: 0 }}
              tickMargin={2}
              height={22}
              tick={{
                fontSize: 10,
                fontWeight: 800,
                fill: colors.head,
                fontFamily,
              }}
            axisLine={false}
              tickLine={false}
            />

            <YAxis
              width={40}
              domain={yAxisDomain}
              ticks={yZoomRange ? undefined : yAxisTicks}
              allowDataOverflow
              tickMargin={2}
              tick={{
                fontSize: 10,
                fontWeight: 800,
                fill: colors.head,
                fontFamily,
              }}
            axisLine={false}
              tickLine={false}
            />

            <Tooltip
              contentStyle={{
                borderRadius: 10,
                border: `1px solid ${colors.border}`,
                fontSize: 11,
                fontWeight: 600,
                color: colors.head,
                fontFamily,
                boxShadow: "0 8px 20px rgba(15,23,42,0.16)",
              }}
              labelStyle={{
                fontWeight: 800,
                color: colors.head,
                fontFamily,
                fontSize: 11,
              }}
              itemStyle={{
                fontFamily,
                fontWeight: 700,
                fontSize: 11,
              }}
              formatter={(value, name) => [value, name]}
              labelFormatter={(label, payload) => {
                const currentInterval = payload?.[0]?.payload?.interval || timeRange;
                const intervalText =
                  currentInterval >= 60
                    ? `${Math.round(currentInterval / 60)}m`
                    : `${currentInterval}s`;

                return `Time: ${label} | Interval: ${intervalText}`;
              }}
            />

            {selectedMachines.map((id) => (
              <Line
                key={`${dataPrefix}_${id}`}
                type="monotone"
                dataKey={`${dataPrefix}_${id}`}
                name={machineNameMap?.[id] || `Machine ${id}`}
                dot={false}
                strokeWidth={2.3}
                stroke={machineColors[(id - 1) % machineColors.length]}
                activeDot={{ r: 4, strokeWidth: 1.5 }}
                isAnimationActive={false}
                connectNulls={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </Box>
    </Paper>
  );
}

function chartSideNavButtonSx(colors, fontFamily, side) {
  return {
    position: "absolute",
    bottom: 40,
    [side]: side === "left" ? 55 : 40,
    zIndex: 20,
    minWidth: 25,
    height: 25,
    px: 0.75,
    py: 0,
    
    borderRadius: 1.5,
    fontFamily,
    fontSize: 11,
    fontWeight: 900,
    lineHeight: 1,
    textTransform: "none",
    color: colors.head,
    bgcolor: "rgba(255,255,255,0.92)",
    border: `1px solid ${colors.border}`,
    boxShadow: "0 2px 6px rgba(15,23,42,0.12)",
    "&:hover": {
      bgcolor: "#38bdf8",
      color: "#000",
      borderColor: "#0284c7",
      boxShadow: "0 3px 8px rgba(15,23,42,0.16)",
    },
    "&.Mui-disabled": {
      bgcolor: "rgba(241,245,249,0.9)",
      color: "#94a3b8",
      borderColor: colors.border,
    },
  };
}
