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
  Select,
  MenuItem,
  TextField,
  Popover,
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

const CHART_OPTIONS = [
  { value: "moldTemp", label: "Mold Temperature" },
  { value: "envTemp", label: "Ambient Temperature" },
  { value: "hum", label: "Humidity" },
];

const DEFAULT_TIME_OPTIONS = [
  { value: 10, label: "10s" },
  { value: 30, label: "30s" },
  { value: 60, label: "60s" },
];

const CHART_POINTS = 100;
const NO_DATA_LIMIT_MULTIPLIER = 3;

const parseDbDateTime = (value) => {
  if (!value) return null;

  const normalized = String(value).replace(" ", "T");
  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) return null;

  return date;
};

const formatDateTimeLocalInput = (date) => {
  if (!date) return "";

  const pad = (n) => String(n).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const parseDateTimeLocalInput = (value) => {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  return date;
};
const formatDateDisplay = (date) => {
  if (!date) return "";

  const pad = (n) => String(n).padStart(2, "0");

  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
};

const formatTimeDisplay12h = (date) => {
  if (!date) return "";

  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const suffix = hours >= 12 ? "PM" : "AM";

  hours = hours % 12;
  if (hours === 0) hours = 12;

  return `${String(hours).padStart(2, "0")}:${minutes} ${suffix}`;
};

const formatDateInput = (date) => {
  if (!date) return "";

  const pad = (n) => String(n).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const formatTimeInput = (date) => {
  if (!date) return "";

  const pad = (n) => String(n).padStart(2, "0");

  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
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

  const [lastRefreshAt, setLastRefreshAt] = useState(null);
  const [latestMachineMap, setLatestMachineMap] = useState({});

  // null = realtime latest window
  // Date = history mode, load 100 chart points ending at this selected datetime
  const [selectedEndTime, setSelectedEndTime] = useState(null);
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
      return Number(interval || 10) * CHART_POINTS * 1000;
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
    async (interval, showLoading = true, endTimeValue = selectedEndTime) => {
      try {
        if (showLoading) {
          setLoading(true);
        }

        const endTime = endTimeValue ? new Date(endTimeValue) : null;

        const [chartRes] = await Promise.all([
          temperatureHumidityApi.getChartData({
            interval,
            points: CHART_POINTS,
            ...(endTime ? { endTime: formatApiDateTime(endTime) } : {}),
          }),
          loadLatestMachines(),
        ]);

        setHistory(Array.isArray(chartRes.data) ? chartRes.data : []);
        setLastRefreshAt(endTime || new Date());
      } catch (error) {
        console.error("Failed to load chart data:", error);
        setHistory([]);
        setLastRefreshAt(endTimeValue ? new Date(endTimeValue) : new Date());
      } finally {
        if (showLoading) {
          setLoading(false);
        }
      }
    },
    [loadLatestMachines, selectedEndTime]
  );

  useEffect(() => {
    if (!open) {
      setChartInitialized(false);
      setHistory([]);
      setLastRefreshAt(null);
      setLatestMachineMap({});
      setSelectedEndTime(null);
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
          nextTimeOptions = data.map((item) => ({
            value: item.value || item.intervalSeconds,
            label: item.label,
            isDefault: item.isDefault,
          }));

          const defaultOption =
            nextTimeOptions.find((x) => x.isDefault) || nextTimeOptions[0];

          if (defaultOption?.value) {
            nextTimeRange = Number(defaultOption.value);
          }
        }

        setTimeOptions(nextTimeOptions);
        setTimeRange(nextTimeRange);
        setSelectedEndTime(null);

        await loadChartData(nextTimeRange, false, null);

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
      loadChartData(timeRange, false, null);
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
    if (!Array.isArray(history)) return [];

    return history.map((row) => {
      const next = { ...row };

      disconnectedMachineIds.forEach((machineId) => {
        delete next[`moldTemp_${machineId}`];
        delete next[`temp_${machineId}`];
        delete next[`hum_${machineId}`];
      });

      return next;
    });
  }, [history, disconnectedMachineIds]);

  const charts = useMemo(() => {
    const allCharts = [
      {
        key: "moldTemp",
        title: "Mold Temperature (°C)",
        dataPrefix: "moldTemp",
        domain: [0, 120],
      },
      {
        key: "envTemp",
        title: "Ambient Temperature (°C)",
        dataPrefix: "temp",
        domain: [0, 60],
      },
      {
        key: "hum",
        title: "Humidity (%)",
        dataPrefix: "hum",
        domain: [0, 100],
      },
    ];

    return allCharts.filter((item) => visibleCharts.includes(item.key));
  }, [visibleCharts]);

  const chartGridRows =
    charts.length === 1
      ? "1fr"
      : charts.length === 2
      ? "1fr 1fr"
      : charts.length === 3
      ? "1fr 1fr 1fr"
      : "1fr";

  const handleBackTime = useCallback(async () => {
    const baseEndTime = selectedEndTime || lastRefreshAt || new Date();
    const nextEndTime = new Date(baseEndTime.getTime() - getWindowMs(timeRange));

    setSelectedEndTime(nextEndTime);
    await loadChartData(timeRange, true, nextEndTime);
  }, [selectedEndTime, lastRefreshAt, getWindowMs, loadChartData, timeRange]);

  const handleNextTime = useCallback(async () => {
    if (!selectedEndTime) return;

    const now = new Date();
    const nextEndTime = new Date(
      selectedEndTime.getTime() + getWindowMs(timeRange)
    );

    if (nextEndTime >= now) {
      setSelectedEndTime(null);
      await loadChartData(timeRange, true, null);
      return;
    }

    setSelectedEndTime(nextEndTime);
    await loadChartData(timeRange, true, nextEndTime);
  }, [selectedEndTime, getWindowMs, loadChartData, timeRange]);

  const handleDateTimeChange = useCallback(
    async (dateValue, timeValue) => {
      const nextEndTime = combineDateAndTimeInput(dateValue, timeValue);

      if (!nextEndTime) {
        setSelectedEndTime(null);
        await loadChartData(timeRange, true, null);
        return;
      }

      const now = new Date();
      const safeEndTime = nextEndTime > now ? now : nextEndTime;

      setSelectedEndTime(safeEndTime);
      await loadChartData(timeRange, true, safeEndTime);
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
              gridTemplateRows: "54px 1fr",
              gap: 1.25,
              overflow: "hidden",
            }}
          >
            <ChartToolbar
              colors={colors}
              fontFamily={fontFamily}
              visibleCharts={visibleCharts}
              setVisibleCharts={setVisibleCharts}
              timeRange={timeRange}
              setTimeRange={setTimeRange}
              onTimeRangeChange={async (nextTimeRange) => {
                setTimeRange(nextTimeRange);
                await loadChartData(nextTimeRange, true, selectedEndTime);
              }}
              timeOptions={timeOptions}
              loading={loading}
              selectedEndTime={selectedEndTime}
              lastRefreshAt={lastRefreshAt}
              onBackTime={handleBackTime}
              onNextTime={handleNextTime}
              onDateTimeChange={handleDateTimeChange}
            />

            <Box
              sx={{
                minHeight: 0,
                display: "grid",
                gridTemplateRows: chartGridRows,
                gap: 1,
                overflow: "hidden",
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

              {charts.map((chart) => (
                <ChartBox
                  key={chart.key}
                  title={chart.title}
                  data={filteredHistory}
                  selectedMachines={selectedMachines}
                  disconnectedMachineIds={disconnectedMachineIds}
                  noDataLimitSeconds={noDataLimitSeconds}
                  dataPrefix={chart.dataPrefix}
                  machineColors={machineColors}
                  colors={colors}
                  fontFamily={fontFamily}
                  domain={chart.domain}
                  timeRange={timeRange}
                  loading={loading}
                  machineNameMap={machineNameMap}
                />
              ))}
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

function ChartToolbar({
  colors,
  fontFamily,
  visibleCharts,
  setVisibleCharts,
  timeRange,
  setTimeRange,
  onTimeRangeChange,
  timeOptions,
  loading,
  selectedEndTime,
  lastRefreshAt,
  onBackTime,
  onNextTime,
  onDateTimeChange,
}) {
  const [pickerAnchorEl, setPickerAnchorEl] = React.useState(null);

  const isAllChecked = visibleCharts.length === CHART_OPTIONS.length;
  const isHistoryMode = Boolean(selectedEndTime);

  const currentDateTime = selectedEndTime || lastRefreshAt || new Date();
  const currentDateValue = formatDateInput(currentDateTime);
  const currentTimeValue = formatTimeInput(currentDateTime);

  const [draftDate, setDraftDate] = React.useState(currentDateValue);
  const [draftTime, setDraftTime] = React.useState(currentTimeValue);

  useEffect(() => {
    setDraftDate(currentDateValue);
    setDraftTime(currentTimeValue);
  }, [currentDateValue, currentTimeValue]);

  const handleToggleAll = () => {
    if (isAllChecked) {
      setVisibleCharts([]);
    } else {
      setVisibleCharts(CHART_OPTIONS.map((x) => x.value));
    }
  };

  const handleToggleChart = (value) => {
    setVisibleCharts((prev) => {
      if (prev.includes(value)) {
        return prev.filter((x) => x !== value);
      }
      return [...prev, value];
    });
  };

  const selectedChartText =
    visibleCharts.length === 0
      ? "No chart selected"
      : isAllChecked
      ? "All"
      : CHART_OPTIONS.filter((item) => visibleCharts.includes(item.value))
          .map((item) => item.label)
          .join(", ");

  const openPicker = Boolean(pickerAnchorEl);

  const applyDateTimeChange = async (nextDate, nextTime) => {
    setDraftDate(nextDate);
    setDraftTime(nextTime);
    await onDateTimeChange(nextDate, nextTime);
  };

  return (
    <Paper
      elevation={0}
      sx={{
        height: 54,
        px: 1.25,
        borderRadius: 2.5,
        border: `1px solid ${colors.border}`,
        bgcolor: "#ebe7e7",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 1,
        overflow: "hidden",
        mt: 1,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
        <Typography
          sx={{
            fontFamily,
            fontSize: 13,
            fontWeight: 800,
            color: colors.head,
            whiteSpace: "nowrap",
          }}
        >
          Chart:
        </Typography>

        <Select
          multiple
          size="small"
          value={visibleCharts}
          renderValue={() => selectedChartText}
          sx={selectSx(colors, fontFamily, 260)}
          MenuProps={{
            PaperProps: {
              sx: {
                borderRadius: 2,
                mt: 1,
                boxShadow: "0 8px 22px rgba(15,23,42,0.16)",
              },
            },
          }}
        >
          <MenuItem
            value="all"
            onClick={handleToggleAll}
            sx={{ fontFamily, fontSize: 13, fontWeight: 800, gap: 1 }}
          >
            <Checkbox
              checked={isAllChecked}
              indeterminate={
                visibleCharts.length > 0 &&
                visibleCharts.length < CHART_OPTIONS.length
              }
              sx={{
                p: 0.5,
                color: colors.head,
                "&.Mui-checked": { color: colors.head },
                "&.MuiCheckbox-indeterminate": { color: colors.head },
              }}
            />
            All
          </MenuItem>

          {CHART_OPTIONS.map((item) => (
            <MenuItem
              key={item.value}
              value={item.value}
              onClick={() => handleToggleChart(item.value)}
              sx={{ fontFamily, fontSize: 13, fontWeight: 800, gap: 1 }}
            >
              <Checkbox
                checked={visibleCharts.includes(item.value)}
                sx={{
                  p: 0.5,
                  color: colors.head,
                  "&.Mui-checked": { color: colors.head },
                }}
              />
              {item.label}
            </MenuItem>
          ))}
        </Select>

        {loading && (
          <Typography
            sx={{
              fontSize: 11,
              fontWeight: 800,
              color: colors.subtle,
              ml: 0.5,
              whiteSpace: "nowrap",
            }}
          >
            Loading...
          </Typography>
        )}
      </Box>

      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
        <Button
          size="small"
          variant="outlined"
          disabled={loading}
          onClick={onBackTime}
          sx={timeNavButtonSx(colors, fontFamily)}
        >
          ◀ Back
        </Button>

        <Button
          onClick={(e) => setPickerAnchorEl(e.currentTarget)}
          disabled={loading}
          variant="outlined"
          sx={{
            height: 34,
            minWidth: "unset",
            width: "fit-content",
            px: 1.1,
            borderRadius: 2,
            fontFamily,
            fontSize: 12,
            fontWeight: 900,
            textTransform: "none",
            color: colors.head,
            borderColor: isHistoryMode ? "#fed7aa" : "#bbf7d0",
            bgcolor: isHistoryMode ? "#fff7ed" : "#ecfdf5",
            justifyContent: "center",
            boxShadow: "none",
            whiteSpace: "nowrap",
            "&:hover": {
              borderColor: colors.head,
              boxShadow: "none",
              bgcolor: isHistoryMode ? "#ffedd5" : "#dcfce7",
            },
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.7 }}>
            <Typography
              sx={{
                fontFamily,
                fontSize: 12,
                fontWeight: 900,
                color: colors.head,
              }}
            >
              {formatDateDisplay(currentDateTime)}
            </Typography>

            <Typography
              sx={{
                fontFamily,
                fontSize: 12,
                fontWeight: 700,
                color: "#9ca3af",
              }}
            >
              |
            </Typography>

            <Typography
              sx={{
                fontFamily,
                fontSize: 12,
                fontWeight: 900,
                color: colors.head,
              }}
            >
              {formatTimeDisplay12h(currentDateTime)}
            </Typography>
          </Box>
        </Button>

        <Popover
          open={openPicker}
          anchorEl={pickerAnchorEl}
          onClose={() => setPickerAnchorEl(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
          transformOrigin={{ vertical: "top", horizontal: "center" }}
          slotProps={{
            paper: {
              sx: {
                mt: 1,
                p: 1.25,
                borderRadius: 2.5,
                border: `1px solid ${colors.border}`,
                boxShadow: "0 10px 28px rgba(15,23,42,0.14)",
              },
            },
          }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
            }}
          >
            <TextField
              size="small"
              type="date"
              value={draftDate}
              inputProps={{ max: formatDateInput(new Date()) }}
              onChange={async (e) => {
                const nextDate = e.target.value;
                setDraftDate(nextDate);
                await applyDateTimeChange(nextDate, draftTime);
              }}
              sx={{
                width: 145,
                "& .MuiInputBase-root": {
                  height: 36,
                  borderRadius: 2,
                  fontFamily,
                  fontSize: 12,
                  fontWeight: 800,
                  bgcolor: colors.white,
                },
                "& .MuiInputBase-input": {
                  py: 0.7,
                  px: 1,
                  fontFamily,
                  fontSize: 12,
                  fontWeight: 800,
                },
              }}
            />

            <Typography
              sx={{
                fontFamily,
                fontSize: 18,
                fontWeight: 700,
                color: "#9ca3af",
                px: 0.2,
                lineHeight: 1,
              }}
            >
              |
            </Typography>

            <TextField
              size="small"
              type="time"
              value={draftTime}
              onChange={async (e) => {
                const nextTime = e.target.value;
                setDraftTime(nextTime);
                await applyDateTimeChange(draftDate, nextTime);
              }}
              sx={{
                width: 110,
                "& .MuiInputBase-root": {
                  height: 36,
                  borderRadius: 2,
                  fontFamily,
                  fontSize: 12,
                  fontWeight: 800,
                  bgcolor: colors.white,
                },
                "& .MuiInputBase-input": {
                  py: 0.7,
                  px: 1,
                  fontFamily,
                  fontSize: 12,
                  fontWeight: 800,
                },
              }}
            />
          </Box>
        </Popover>

        <Button
          size="small"
          variant="outlined"
          disabled={loading || !selectedEndTime}
          onClick={onNextTime}
          sx={timeNavButtonSx(colors, fontFamily)}
        >
          Next ▶
        </Button>

        <Typography
          sx={{
            fontFamily,
            fontSize: 13,
            fontWeight: 800,
            color: colors.head,
            whiteSpace: "nowrap",
            ml: 0.5,
          }}
        >
          Time:
        </Typography>

        <Select
          size="small"
          value={timeRange}
          onChange={(e) => {
            const nextTimeRange = Number(e.target.value);

            if (onTimeRangeChange) {
              onTimeRangeChange(nextTimeRange);
              return;
            }

            setTimeRange(nextTimeRange);
          }}
          sx={selectSx(colors, fontFamily, 92)}
        >
          {timeOptions.map((item) => (
            <MenuItem key={item.value} value={item.value}>
              {item.label}
            </MenuItem>
          ))}
        </Select>
      </Box>
    </Paper>
  );
}

function selectSx(colors, fontFamily, width) {
  return {
    width,
    height: 34,
    borderRadius: 2,
    fontFamily,
    fontSize: 13,
    fontWeight: 800,
    color: colors.head,
    bgcolor: colors.white,

    "& .MuiSelect-select": {
      py: 0.65,
      px: 1,
      fontFamily,
      fontWeight: 800,
      display: "flex",
      alignItems: "center",
    },

    "& .MuiOutlinedInput-notchedOutline": {
      borderColor: colors.border,
    },

    "&:hover .MuiOutlinedInput-notchedOutline": {
      borderColor: colors.head,
    },

    "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
      borderColor: colors.head,
      borderWidth: 1.4,
    },
  };
}

function timeNavButtonSx(colors, fontFamily) {
  return {
    height: 34,
    minWidth: 72,
    px: 1,
    borderRadius: 2,
    fontFamily,
    fontSize: 11.5,
    fontWeight: 800,
    textTransform: "none",
    color: colors.head,
    borderColor: colors.border,
    bgcolor: colors.white,
    boxShadow: "none",
    whiteSpace: "nowrap",

    "&:hover": {
      borderColor: colors.head,
      bgcolor: "#f8fafc",
      boxShadow: "none",
    },

    "&.Mui-disabled": {
      bgcolor: "#f3f4f6",
      color: "#9ca3af",
      borderColor: colors.border,
    },
  };
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
  domain,
  timeRange,
  loading,
  machineNameMap,
}) {
  const xAxisTicks =
    data && data.length > 1 ? [data[0].time, data[data.length - 1].time] : [];

  const disconnectedCount = disconnectedMachineIds?.length || 0;

  const isAllSelectedDisconnected =
    selectedMachines.length > 0 &&
    selectedMachines.every((id) => disconnectedMachineIds.includes(id));

  return (
    <Paper
      elevation={0}
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
              left: -1,
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
              axisLine={{ stroke: colors.subtle, strokeWidth: 1 }}
              tickLine={{ stroke: colors.subtle, strokeWidth: 1 }}
            />

            <YAxis
              width={34}
              domain={domain}
              tickMargin={2}
              tick={{
                fontSize: 10,
                fontWeight: 800,
                fill: colors.head,
                fontFamily,
              }}
              axisLine={{ stroke: colors.subtle, strokeWidth: 1 }}
              tickLine={{ stroke: colors.subtle, strokeWidth: 1 }}
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
              labelFormatter={(label) =>
                `Time: ${label} | Interval: ${timeRange}s`
              }
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