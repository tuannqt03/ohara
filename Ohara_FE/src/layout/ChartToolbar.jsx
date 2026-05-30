import React, { useEffect, useState } from "react";
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
}) {
  const [settingAnchorEl, setSettingAnchorEl] = useState(null);
  const [openSettingSection, setOpenSettingSection] = useState("time");

  const isAllChecked = visibleCharts.length === CHART_OPTIONS.length;
  const openSetting = Boolean(settingAnchorEl);

  const currentDateTime = selectedEndTime || lastRefreshAt || new Date();

  const startDateTime =
    selectedStartTime ||
    new Date(
      currentDateTime.getTime() -
        Number(timeRange || 10) * CHART_POINTS * 1000
    );

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

  // Chỉ fill form khi mở popup, tránh bị lastRefreshAt reset liên tục khi user đang chọn giờ
  useEffect(() => {
    if (!openSetting) return;

    const nextCurrentDateTime = selectedEndTime || lastRefreshAt || new Date();

    const nextStartDateTime =
      selectedStartTime ||
      new Date(
        nextCurrentDateTime.getTime() -
          Number(timeRange || 10) * CHART_POINTS * 1000
      );

    setDraftStartDate(formatDateInput(nextStartDateTime));
    setDraftStartTime(formatTimeInput(nextStartDateTime));
    setDraftEndDate(formatDateInput(nextCurrentDateTime));
    setDraftEndTime(formatTimeInput(nextCurrentDateTime));
  }, [openSetting]);

  useEffect(() => {
    setDraftAxisSettings(chartAxisSettings);
  }, [chartAxisSettings]);

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
        alert(`${chart.shortLabel}: Min, Max, Scale phải là số`);
        return false;
      }

      if (max <= min) {
        alert(`${chart.shortLabel}: Max phải lớn hơn Min`);
        return false;
      }

      if (scale <= 0) {
        alert(`${chart.shortLabel}: Scale phải lớn hơn 0`);
        return false;
      }
    }

    setChartAxisSettings(draftAxisSettings);
    return true;
  };

  const handleApplySettings = async () => {
    const isAxisValid = applyAxisSettings();
    if (!isAxisValid) return;

    console.log("CLICK APPLY TOOLBAR", {
      draftStartDate,
      draftStartTime,
      draftEndDate,
      draftEndTime,
    });

    await onDateTimeRangeChange(
      draftStartDate,
      draftStartTime,
      draftEndDate,
      draftEndTime
    );

    setSettingAnchorEl(null);
  };

  const selectedChartText =
    visibleCharts.length === 0
      ? "No chart selected"
      : isAllChecked
      ? "All"
      : CHART_OPTIONS.filter((item) => visibleCharts.includes(item.value))
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
          value={visibleCharts}
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
                visibleCharts.length > 0 &&
                visibleCharts.length < CHART_OPTIONS.length
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
                checked={visibleCharts.includes(item.value)}
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
          Step:
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
        onClick={(e) => setSettingAnchorEl(e.currentTarget)}
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
        onClose={() => setSettingAnchorEl(null)}
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
                    label="Scale"
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
          gridTemplateColumns: "44px 1fr 100px",
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

      <TextField
        size="small"
        type="time"
        value={timeValue}
        onChange={(e) => setTimeValue(e.target.value)}
        sx={[dateTimeInputSx(colors, fontFamily), { width: "100%" }]}
      />
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
      fontSize: 9.5,
      fontWeight: 800,
      fontFamily,
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