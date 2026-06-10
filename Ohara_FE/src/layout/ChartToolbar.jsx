import React, { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  Box,
  Paper,
  Typography,
  Select,
  MenuItem,
  Checkbox,
  TextField,
  Popover,
  IconButton,
  Button,
  Divider,
} from "@mui/material";
import SettingsIcon from "@mui/icons-material/Settings";
import AccessTimeRoundedIcon from "@mui/icons-material/AccessTimeRounded";
export const CHART_OPTIONS = [
  { value: "moldTemp", label: "Mold Temperature", shortLabel: "Mold Temp" },
  { value: "envTemp", label: "Temperature", shortLabel: "Temp" },
  { value: "hum", label: "Humidity", shortLabel: "Humidity" },
];

const CHART_POINTS = 100;

const formatDateInput = (date) => {
  if (!date) return "";

  const pad = (n) => String(n).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}`;
};

const formatTimeInput = (date) => {
  if (!date) return "";

  const pad = (n) => String(n).padStart(2, "0");

  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export default function ChartToolbar({
  colors,
  fontFamily,
  visibleCharts,
  onSettingOpenChange,
  setVisibleCharts,
  timeRange,
  setTimeRange,
  onTimeRangeChange,
  timeOptions,
  loading,
  selectedEndTime,
  lastRefreshAt,
  chartAxisSettings,
  setChartAxisSettings,
  selectedStartTime,
  onDateTimeRangeChange,
  onResetTimeRange,
}) {
  const [settingAnchorEl, setSettingAnchorEl] = useState(null);
  const [openSettingSection, setOpenSettingSection] = useState("time");

  const safeVisibleCharts = Array.isArray(visibleCharts) ? visibleCharts : [];
  const isAllChecked = safeVisibleCharts.length === CHART_OPTIONS.length;
  const openSetting = Boolean(settingAnchorEl);
  const openSettingPopover = (event) => {
    setSettingAnchorEl(event.currentTarget);
    onSettingOpenChange?.(true, "open");
  };

  const closeSettingPopover = async (action = "close") => {
    setSettingAnchorEl(null);
    await onSettingOpenChange?.(false, action);
  };
  const currentDateTime = selectedEndTime || lastRefreshAt;

  const startDateTime =
  selectedStartTime ||
  (currentDateTime
    ? new Date(
        currentDateTime.getTime() -
          Number(timeRange || 10) * CHART_POINTS * 1000
      )
    : null);

  const [draftStartDate, setDraftStartDate] = useState(
    formatDateInput(startDateTime)
  );
  const [draftStartTime, setDraftStartTime] = useState(
    formatTimeInput(startDateTime)
  );
  const [draftEndDate, setDraftEndDate] = useState(
    formatDateInput(currentDateTime)
  );
  const [draftEndTime, setDraftEndTime] = useState(
    formatTimeInput(currentDateTime)
  );

  const [draftAxisSettings, setDraftAxisSettings] = useState(chartAxisSettings);
  const waitNextTick = () =>
  new Promise((resolve) => window.setTimeout(resolve, 0));

  const closePopoverBeforeLoading = async (action) => {
    flushSync(() => {
      setSettingAnchorEl(null);
    });

    await onSettingOpenChange?.(false, action);

    // Cho browser render trạng thái popup đã đóng trước khi loading bật
    await waitNextTick();
  };
 useEffect(() => {
  if (!openSetting) return;

  const hasCustomRange = Boolean(selectedStartTime && selectedEndTime);
  const nextCurrentDateTime = hasCustomRange ? selectedEndTime : lastRefreshAt;

  if (!nextCurrentDateTime) return;

  const nextStartDateTime = hasCustomRange
    ? selectedStartTime
    : new Date(
        nextCurrentDateTime.getTime() -
          Number(timeRange || 10) * CHART_POINTS * 1000
      );

  setDraftStartDate(formatDateInput(nextStartDateTime));
  setDraftStartTime(formatTimeInput(nextStartDateTime));
  setDraftEndDate(formatDateInput(nextCurrentDateTime));
  setDraftEndTime(formatTimeInput(nextCurrentDateTime));
}, [
  openSetting,
  selectedStartTime,
  selectedEndTime,
  lastRefreshAt,
  timeRange,
]);

  useEffect(() => {
    if (!openSetting) return;

    setDraftAxisSettings(
      JSON.parse(JSON.stringify(chartAxisSettings || {}))
    );
  }, [openSetting, chartAxisSettings]);

  const handleToggleAll = () => {
    if (isAllChecked) {
      setVisibleCharts([]);
    } else {
      setVisibleCharts(CHART_OPTIONS.map((x) => x.value));
    }
  };

  const handleToggleChart = (value) => {
  setVisibleCharts((prev) => {
    const current = Array.isArray(prev) ? prev : [];

    if (current.includes(value)) {
      return current.filter((x) => x !== value);
    }

    return [...current, value];
  });
};

  const updateDraftAxis = (chartKey, field, value) => {
    setDraftAxisSettings((prev) => ({
      ...prev,
      [chartKey]: {
        ...prev[chartKey],
        [field]: value === "" ? "" : Number(value),
      },
    }));
  };

  const applyAxisSettings = () => {
    for (const chart of CHART_OPTIONS) {
      const setting = draftAxisSettings[chart.value] || {};
      const min = Number(setting.min);
      const max = Number(setting.max);
      const scale = Number(setting.scale);

      if (
        !Number.isFinite(min) ||
        !Number.isFinite(max) ||
        !Number.isFinite(scale)
      ) {
        alert(`${chart.shortLabel}: Min, Max, and Scale must be numbers`);
        return false;
      }

      if (max <= min) {
        alert(`${chart.shortLabel}: Max must be greater than Min`);
        return false;
      }

      if (scale <= 0) {
        alert(`${chart.shortLabel}: Scale must be greater than 0`);
        return false;
      }
    }

    setChartAxisSettings(draftAxisSettings);
    return true;
  };

  const handleApplySettings = async () => {
    const isAxisValid = applyAxisSettings();
    if (!isAxisValid) return;

    if (openSettingSection === "axis") {
      await closePopoverBeforeLoading("axisApply");
      return;
    }

    const didApplyTimeRange = await onDateTimeRangeChange(
      draftStartDate,
      draftStartTime,
      draftEndDate,
      draftEndTime,
      {
        beforeLoad: () => closePopoverBeforeLoading("timeApply"),
      }
    );

    if (didApplyTimeRange === false) {
      return;
    }
  };
  const handleResetTimeRange = async () => {
    await onResetTimeRange?.();
  };
  const selectedChartText =
  safeVisibleCharts.length === 0
    ? "No chart selected"
    : isAllChecked
    ? "All"
    : CHART_OPTIONS.filter((item) =>
        safeVisibleCharts.includes(item.value)
      )
        .map((item) => item.label)
        .join(", ");

  return (
    <Paper
      elevation={0}
      sx={{
        minHeight: 58,
        px: 1.25,
        py: 0.75,
        borderRadius: 2.5,
        border: `1px solid ${colors.border}`,
        bgcolor: "#ebe7e7",
        display: "grid",
        gridTemplateColumns: "minmax(300px, 1fr) auto auto",
        alignItems: "center",
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
            fontWeight: 900,
            color: colors.head,
            whiteSpace: "nowrap",
          }}
        >
          Chart:
        </Typography>

        <Select
          multiple
          size="small"
          value={safeVisibleCharts}
          renderValue={() => selectedChartText}
          sx={selectSx(colors, fontFamily, 280)}
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
                safeVisibleCharts.length > 0 &&
                safeVisibleCharts.length < CHART_OPTIONS.length
              }
              sx={checkSx(colors)}
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
                checked={safeVisibleCharts.includes(item.value)}
                sx={checkSx(colors)}
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
        
        <Typography
          sx={{
            fontFamily,
            fontSize: 13,
            fontWeight: 900,
            color: colors.head,
            whiteSpace: "nowrap",
          }}
        >
          Sample Time:
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

      <IconButton
        disabled={loading}
        onClick={openSettingPopover}
        sx={{
          width: 38,
          height: 38,
          borderRadius: 2,
          border: `1px solid ${colors.border}`,
          bgcolor: colors.white,
          color: colors.head,
          boxShadow: "none",
          "&:hover": {
            borderColor: colors.head,
            bgcolor: "#f8fafc",
          },
          "&.Mui-disabled": {
            bgcolor: "#f3f4f6",
            color: "#9ca3af",
            borderColor: colors.border,
          },
        }}
      >
        <SettingsIcon fontSize="small" />
      </IconButton>

      <Popover
        open={openSetting}
        anchorEl={settingAnchorEl}
        onClose={() => closeSettingPopover("close")}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          paper: {
            sx: {
              mt: 1,
              p: 1,
              width: 300,
              maxWidth: "100%",
              maxHeight: "calc(100vh - 140px)",
              overflowY: "auto",
              borderRadius: 2.5,
              border: `1px solid ${colors.border}`,
              boxShadow: "0 10px 28px rgba(15,23,42,0.14)",
              zIndex: 9999,
            },
          },
        }}
      >
        <Box sx={{ display: "grid", gap: 0.75 }}>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 0.75,
            }}
          >
            <Button
              variant={openSettingSection === "time" ? "contained" : "outlined"}
              onClick={() => setOpenSettingSection("time")}
              sx={tabButtonSx(colors, fontFamily)}
            >
              Time Range
            </Button>

            <Button
              variant={openSettingSection === "axis" ? "contained" : "outlined"}
              onClick={() => setOpenSettingSection("axis")}
              sx={tabButtonSx(colors, fontFamily)}
            >
              Y Axis
            </Button>
          </Box>

          <Divider />

          {openSettingSection === "time" && (
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "1fr",
                gap: 1.25,
                maxWidth: 420,
                mt: 1,
                width: "100%",
                mx: "auto",
              }}
            >

              <RangeInputRow
                label="From:"
                dateValue={draftStartDate}
                timeValue={draftStartTime}
                setDateValue={setDraftStartDate}
                setTimeValue={setDraftStartTime}
                colors={colors}
                fontFamily={fontFamily}
              />

              <Divider />

              <RangeInputRow
                label="To:"
                dateValue={draftEndDate}
                timeValue={draftEndTime}
                setDateValue={setDraftEndDate}
                setTimeValue={setDraftEndTime}
                colors={colors}
                fontFamily={fontFamily}
              />
            </Box>
          )}

          {openSettingSection === "axis" && (
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(3, minmax(0, 1fr))",
                gap: 1.2,
              }}
            >
              {CHART_OPTIONS.map((chart) => (
                <Box
                  key={chart.value}
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "1fr",
                    gap: 1.5,
                  }}
                >
                  <Typography
                    sx={{
                      fontFamily,
                      fontSize: 11.5,
                      fontWeight: 900,
                      color: colors.head,
                    }}
                  >
                    {chart.shortLabel}
                  </Typography>

                  <TextField
                    size="small"
                    type="number"
                    label="Min"
                    value={draftAxisSettings[chart.value]?.min ?? ""}
                    onChange={(e) =>
                      updateDraftAxis(chart.value, "min", e.target.value)
                    }
                    sx={[axisInputSx(colors, fontFamily), { width: "100%" }]}
                  />

                  <TextField
                    size="small"
                    type="number"
                    label="Max"
                    value={draftAxisSettings[chart.value]?.max ?? ""}
                    onChange={(e) =>
                      updateDraftAxis(chart.value, "max", e.target.value)
                    }
                    sx={[axisInputSx(colors, fontFamily), { width: "100%" }]}
                  />

                  <TextField
                    size="small"
                    type="number"
                    label="Step"
                    value={draftAxisSettings[chart.value]?.scale ?? ""}
                    onChange={(e) =>
                      updateDraftAxis(chart.value, "scale", e.target.value)
                    }
                    sx={[axisInputSx(colors, fontFamily), { width: "100%" }]}
                  />
                </Box>
              ))}
            </Box>
          )}

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 1,
              mt: 0.25,
            }}
          >
            <Button
              type="button"
              variant="outlined"
              size="small"
              onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                await closeSettingPopover("cancel");
              }}
              sx={cancelButtonSx(colors, fontFamily)}
            >
              Cancel
            </Button>

            <Button
              type="button"
              variant="contained"
              size="small"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleApplySettings();
              }}
              sx={applyButtonSx(colors, fontFamily)}
            >
              Apply
            </Button>
          </Box>
        </Box>
      </Popover>
    </Paper>
  );
}

function RangeInputRow({
  label,
  dateValue,
  timeValue,
  setDateValue,
  setTimeValue,
  colors,
  fontFamily,
  sx,
}) {
  return (
    <Box
      sx={[
        {
          display: "grid",
          gridTemplateColumns: "44px 1fr 112px",
          gap: 1.5,
          alignItems: "center",
          width: "100%",
        },
        sx,
      ]}
    >
      <Typography
        sx={{
          fontFamily,
          fontSize: 12,
          fontWeight: 900,
          color: colors.head,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </Typography>

      <TextField
        size="small"
        type="date"
        value={dateValue}
        slotProps={{
          htmlInput: {
            max: formatDateInput(new Date()),
          },
        }}
        onChange={(e) => setDateValue(e.target.value)}
        sx={[dateTimeInputSx(colors, fontFamily), { width: "100%" }]}
      />

      <MuiXTimePicker
        value={timeValue}
        onChange={setTimeValue}
        colors={colors}
        fontFamily={fontFamily}
      />
    </Box>
  );
}
function MuiXTimePicker({ value, onChange, colors, fontFamily }) {
  const [anchorEl, setAnchorEl] = useState(null);
  const [draftHour, setDraftHour] = useState("00");
  const [draftMinute, setDraftMinute] = useState("00");

  const open = Boolean(anchorEl);

  const splitTime = (timeText) => {
    const [hour = "00", minute = "00"] = String(timeText || "").split(":");

    return {
      hour: String(hour).padStart(2, "0").slice(0, 2),
      minute: String(minute).padStart(2, "0").slice(0, 2),
    };
  };

  const openPicker = (event) => {
    const current = splitTime(value);
    setDraftHour(current.hour);
    setDraftMinute(current.minute);
    setAnchorEl(event.currentTarget);
  };

  const closePicker = () => {
    setAnchorEl(null);
  };

  const acceptPicker = () => {
    onChange(`${draftHour}:${draftMinute}`);
    closePicker();
  };

  const hours = Array.from({ length: 24 }, (_, index) =>
    String(index).padStart(2, "0")
  );

  const minutes = Array.from({ length: 60 }, (_, index) =>
    String(index).padStart(2, "0")
  );

  return (
    <>
      <Box
        onClick={openPicker}
        sx={{
          height: 38,
          width: "100%",
          borderRadius: 2,
          border: `1px solid ${colors.border}`,
          bgcolor: colors.white,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 0.75,
          cursor: "pointer",
          fontFamily,
          fontSize: 13,
          fontWeight: 900,
          color: colors.head,
          letterSpacing: 0.6,
          userSelect: "none",
          "&:hover": {
            borderColor: colors.head,
            bgcolor: "#f8fafc",
          },
        }}
      >
        <Box component="span">{value || "--:--"}</Box>
        <AccessTimeRoundedIcon
          sx={{
            fontSize: 16,
            color: colors.subtle,
          }}
        />
      </Box>

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={closePicker}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          paper: {
            sx: {
              mt: 0.75,
              width: 190,
              borderRadius: 2.5,
              border: `1px solid ${colors.border}`,
              boxShadow: "0 12px 30px rgba(15,23,42,0.18)",
              overflow: "hidden",
              zIndex: 10000,
            },
          },
        }}
      >
        <Box sx={{ p: 1 }}>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 0.8,
              mb: 0.8,
            }}
          >
            <Typography
              sx={{
                fontFamily,
                fontSize: 11,
                fontWeight: 900,
                color: colors.subtle,
                textAlign: "center",
              }}
            >
              Hour
            </Typography>

            <Typography
              sx={{
                fontFamily,
                fontSize: 11,
                fontWeight: 900,
                color: colors.subtle,
                textAlign: "center",
              }}
            >
              Minute
            </Typography>
          </Box>

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 0.8,
            }}
          >
            <TimeColumn
              items={hours}
              value={draftHour}
              onChange={setDraftHour}
              colors={colors}
              fontFamily={fontFamily}
            />

            <TimeColumn
              items={minutes}
              value={draftMinute}
              onChange={setDraftMinute}
              colors={colors}
              fontFamily={fontFamily}
            />
          </Box>

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 0.8,
              mt: 1,
              pt: 1,
              borderTop: `1px solid ${colors.border}`,
            }}
          >
            <Button
              size="small"
              variant="outlined"
              onClick={closePicker}
              sx={cancelButtonSx(colors, fontFamily)}
            >
              Cancel
            </Button>

            <Button
              size="small"
              variant="contained"
              onClick={acceptPicker}
              sx={applyButtonSx(colors, fontFamily)}
            >
              OK
            </Button>
          </Box>
        </Box>
      </Popover>
    </>
  );
}

function TimeColumn({ items, value, onChange, colors, fontFamily }) {
  const selectedRef = useRef(null);

  useEffect(() => {
    if (!selectedRef.current) return;

    selectedRef.current.scrollIntoView({
      block: "center",
      behavior: "auto",
    });
  }, [value]);

  return (
    <Box
      sx={{
        height: 192,
        overflowY: "auto",
        borderRadius: 2,
        border: `1px solid ${colors.border}`,
        bgcolor: "#f8fafc",
        p: 0.35,

        "&::-webkit-scrollbar": {
          width: 5,
        },

        "&::-webkit-scrollbar-thumb": {
          backgroundColor: "#cbd5e1",
          borderRadius: 999,
        },
      }}
    >
      {items.map((item) => {
        const selected = item === value;

        return (
          <Box
            key={item}
            ref={selected ? selectedRef : null}
            onClick={() => onChange(item)}
            sx={{
              height: 30,
              borderRadius: 1.5,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              fontFamily,
              fontSize: 13,
              fontWeight: 900,
              color: selected ? colors.white : colors.head,
              bgcolor: selected ? colors.head : "transparent",
              mb: 0.25,
              userSelect: "none",
              "&:hover": {
                bgcolor: selected ? colors.head : "#e5e7eb",
              },
            }}
          >
            {item}
          </Box>
        );
      })}
    </Box>
  );
}

function checkSx(colors) {
  return {
    p: 0.5,
    color: colors.head,
    "&.Mui-checked": { color: colors.head },
    "&.MuiCheckbox-indeterminate": { color: colors.head },
  };
}

function tabButtonSx(colors, fontFamily) {
  return {
    height: 36,
    borderRadius: 2,
    fontFamily,
    fontSize: 12,
    fontWeight: 900,
    textTransform: "none",
    boxShadow: "none",
    color: colors.head,
    borderColor: colors.border,
    "&.MuiButton-contained": {
      color: colors.white,
      bgcolor: colors.head,
    },
    "&.MuiButton-contained:hover": {
      bgcolor: "#000",
      boxShadow: "none",
    },
    "&.MuiButton-outlined:hover": {
      borderColor: colors.head,
      bgcolor: "#f8fafc",
    },
  };
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

function dateTimeInputSx(colors, fontFamily) {
  return {
    "& .MuiInputBase-root": {
      height: 38,
      borderRadius: 2,
      fontFamily,
      fontSize: 12,
      fontWeight: 800,
      bgcolor: colors.white,
    },
    "& .MuiInputBase-input": {
      py: 0.55,
      px: 0.45,
      fontFamily,
      fontSize: 12,
      fontWeight: 800,
    },
  };
}

function axisInputSx(colors, fontFamily) {
  return {
    "& .MuiInputBase-root": {
      height: 38,
      borderRadius: 2,
      fontFamily,
      fontSize: 12,
      fontWeight: 900,
      bgcolor: colors.white,
    },
    "& .MuiInputBase-input": {
      py: 0.55,
      px: 0.8,
      fontFamily,
      fontSize: 12,
      fontWeight: 800,
    },
    "& .MuiInputLabel-root": {
      fontSize: 11,
      fontWeight: 900,
      fontFamily,
      color: colors.head,
    },

    "& .MuiInputLabel-root.Mui-focused": {
      color: colors.head,
    },
  };
}
function cancelButtonSx(colors, fontFamily) {
  return {
    height: 34,
    borderRadius: 2,
    fontFamily,
    fontSize: 12,
    fontWeight: 900,
    textTransform: "none",
    color: colors.head,
    borderColor: colors.border,
    bgcolor: colors.white,
    boxShadow: "none",
    "&:hover": {
      borderColor: colors.head,
      bgcolor: "#f8fafc",
      boxShadow: "none",
    },
  };
}

function applyButtonSx(colors, fontFamily) {
  return {
    height: 34,
    borderRadius: 2,
    fontFamily,
    fontSize: 12,
    fontWeight: 900,
    textTransform: "none",
    bgcolor: colors.head,
    boxShadow: "none",
    mt: 0.25,
    "&:hover": {
      bgcolor: "#000",
      boxShadow: "none",
    },
  };
}
function resetButtonSx(colors, fontFamily) {
  return {
    height: 34,
    minWidth: 76,
    borderRadius: 2,
    fontFamily,
    fontSize: 12,
    fontWeight: 900,
    textTransform: "none",
    color: colors.head,
    borderColor: colors.border,
    bgcolor: colors.white,
    boxShadow: "none",
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