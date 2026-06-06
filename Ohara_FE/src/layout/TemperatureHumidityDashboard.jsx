import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Paper,
  Typography,
  Button,
  Chip,
  IconButton,
  ClickAwayListener,
} from "@mui/material";
import SettingsIcon from "@mui/icons-material/Settings";
import ShowChartIcon from "@mui/icons-material/ShowChart";
import MenuIcon from "@mui/icons-material/Menu";

import ThresholdSettingDialog from "./ThresholdSettingDialog";
import MachineChartDialog from "./MachineChartDialog";
import WarningLogDialog from "./WarningLogPage";
import { temperatureHumidityApi } from "../config/api";

const COLORS = {
  head: "#212222",
  subtle: "#6b7280",
  border: "#d9e2ec",
  bg: "#eef3f8",
  white: "#ffffff",
  teal: "#075f68",
  alarm: "#dc2626",
  warning: "#d97706",
};

const FONT_FAMILY = '"Roboto", "Arial", sans-serif';

const MACHINE_COLORS = [
  "#2563eb",
  "#dc2626",
  "#16a34a",
  "#9333ea",
  "#ea580c",
  "#0891b2",
  "#be123c",
  "#4f46e5",
  "#65a30d",
  "#ca8a04",
  "#0f766e",
  "#7c2d12",
  "#1d4ed8",
  "#b91c1c",
  "#15803d",
  "#6d28d9",
  "#c2410c",
  "#0369a1",
  "#0ea5e9",
  "#84cc16",
  "#f97316",
  "#14b8a6",
  "#a855f7",
  "#ef4444",
];
const DASHBOARD_REFRESH_MS = 10 * 1000;

const DASHBOARD_AUTO_RELOAD_MS = 30 * 60 * 1000;

const DASHBOARD_RESTORE_KEY = "temperatureHumidityDashboardRestoreV1";
const statusStyle = {
  normal: {
    label: "Normal",
    color: "#16a34a",
    bg: "linear-gradient(90deg,#16a34a,#22c55e)",
    icon: "✅",
  },
  warning: {
    label: "Warning",
    color: "#d97706",
    bg: "linear-gradient(90deg,#d97706,#facc15)",
    icon: "⚠️",
  },
  alarm: {
    label: "Alarm",
    color: "#dc2626",
    bg: "linear-gradient(90deg,#b91c1c,#ef4444)",
    icon: "🔴",
  },
  disconnected: {
    label: "No Data",
    color: "#6b7280",
    bg: "linear-gradient(90deg,#6b7280,#9ca3af)",
    icon: "⚫",
  },
  nodata: {
    label: "No Data",
    color: "#6b7280",
    bg: "linear-gradient(90deg,#6b7280,#9ca3af)",
    icon: "⚫",
  },
};

const getDisplayStatus = (m) => {
  if (!m) return "normal";

  if (
    m.isDisconnected ||
    m.status === "disconnected" ||
    m.status === "nodata"
  ) {
    return "disconnected";
  }

  if (["normal", "warning", "alarm"].includes(m.status)) {
    return m.status;
  }

  if (m.currentStatus === "nodata") {
    return "disconnected";
  }

  if (["normal", "warning", "alarm"].includes(m.currentStatus)) {
    return m.currentStatus;
  }

  return "normal";
};

const getCardStatusColor = (status) => {
  if (status === "alarm") return "#dc2626";
  if (status === "warning") return "#d97706";
  if (status === "disconnected") return "#6b7280";
  return "#16a34a";
};

const formatMetric = (value, unit) => {
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    Number(value) === 0
  ) {
    return "--";
  }

  return `${value}${unit}`;
};
const loadSavedDashboardState = () => {
  try {
    const raw = window.sessionStorage.getItem(DASHBOARD_RESTORE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);

    window.sessionStorage.removeItem(DASHBOARD_RESTORE_KEY);

    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    console.warn("Failed to load dashboard restore state:", error);
    return null;
  }
};
export default function TemperatureHumidityDashboard({ defaultOpenChart = false }) {
  const savedDashboardState = useMemo(() => loadSavedDashboardState(), []);
  const [machines, setMachines] = useState([]);
  const [outdoorWeather, setOutdoorWeather] = useState({
    temp: null,
    hum: null,
    recordedAt: null,
    isDisconnected: true,
  });

  const [settingOpen, setSettingOpen] = useState(
  Boolean(savedDashboardState?.settingOpen)
  );

  const [selectedSettingMachine, setSelectedSettingMachine] = useState(
    savedDashboardState?.selectedSettingMachine || null
  );

  const [machineSetting, setMachineSetting] = useState(null);
  const navigate = useNavigate();
  const hasOpenedChartFromRoute = useRef(false);
  const autoReloadTimerRef = useRef(null);
  const [chartOpen, setChartOpen] = useState(
    savedDashboardState?.chartOpen ?? defaultOpenChart
  );

  const [chartMode, setChartMode] = useState(
    savedDashboardState?.chartMode || "all"
  );

  const [selectedMachines, setSelectedMachines] = useState(
    Array.isArray(savedDashboardState?.selectedMachines)
      ? savedDashboardState.selectedMachines
      : null
  );

  const [selectedLogMachine, setSelectedLogMachine] = useState(
    savedDashboardState?.selectedLogMachine || null
  );

  const [actionMenuOpen, setActionMenuOpen] = useState(
    Boolean(savedDashboardState?.actionMenuOpen)
  );

  const [warningLogOpen, setWarningLogOpen] = useState(
    Boolean(savedDashboardState?.warningLogOpen)
  );
  const [loading, setLoading] = useState(false);
  const machineIds = useMemo(() => machines.map((m) => m.id), [machines]);
  const dashboardStateRef = useRef({
    chartOpen: false,
    chartMode: "all",
    selectedMachines: null,
    actionMenuOpen: false,
    warningLogOpen: false,
    settingOpen: false,
    selectedSettingMachine: null,
    selectedLogMachine: null,
  });
  useEffect(() => {
    dashboardStateRef.current = {
      chartOpen,
      chartMode,
      selectedMachines,
      actionMenuOpen,
      warningLogOpen,
      settingOpen,
      selectedSettingMachine,
      selectedLogMachine,
    };
  }, [
    chartOpen,
    chartMode,
    selectedMachines,
    actionMenuOpen,
    warningLogOpen,
    settingOpen,
    selectedSettingMachine,
    selectedLogMachine,
  ]);
  useEffect(() => {
    if (!defaultOpenChart) return;
    if (machineIds.length === 0) return;
    if (hasOpenedChartFromRoute.current) return;

    hasOpenedChartFromRoute.current = true;

    setChartMode((prev) => savedDashboardState?.chartMode || prev || "all");

    setSelectedMachines((prev) => {
      if (Array.isArray(prev)) return prev;
      return machineIds;
    });
  }, [defaultOpenChart, machineIds, savedDashboardState]);

  const loadOutdoorWeather = async () => {
    try {
      const res = await temperatureHumidityApi.getOutdoorWeatherLatest();

      setOutdoorWeather({
        temp: res.data?.temp ?? null,
        hum: res.data?.hum ?? null,
        recordedAt: res.data?.recordedAt ?? null,
        isDisconnected: Boolean(res.data?.isDisconnected),
      });
    } catch (error) {
      console.error("Failed to load outdoor weather:", error);

      setOutdoorWeather({
        temp: null,
        hum: null,
        recordedAt: null,
        isDisconnected: true,
      });
    }
  };

  const loadDashboardData = async (showLoading = false) => {
    try {
      if (showLoading) {
        setLoading(true);
      }

      const machineRes = await temperatureHumidityApi.getLatestMachines();
      const nextMachines = Array.isArray(machineRes.data) ? machineRes.data : [];

      setMachines(nextMachines);

      setSelectedMachines((prev) => {
        if (prev !== null) return prev;

        return nextMachines.map((m) => m.id);
      });
    } catch (error) {
      console.error("Failed to load machines:", error);
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
  let alive = true;
  let running = false;

  const saveDashboardStateAndReload = () => {
    if (!alive) return;

    const currentState = dashboardStateRef.current;

    try {
      window.sessionStorage.setItem(
        DASHBOARD_RESTORE_KEY,
        JSON.stringify({
          chartOpen: currentState.chartOpen,
          chartMode: currentState.chartMode,
          selectedMachines: currentState.selectedMachines,
          actionMenuOpen: currentState.actionMenuOpen,
          warningLogOpen: currentState.warningLogOpen,
          settingOpen: currentState.settingOpen,
          selectedSettingMachine: currentState.selectedSettingMachine,
          selectedLogMachine: currentState.selectedLogMachine,
        })
      );
    } catch (error) {
      console.warn("Failed to save dashboard restore state:", error);
    }

    window.location.reload();
  };

  const resetAutoReloadTimer = () => {
    if (autoReloadTimerRef.current) {
      clearTimeout(autoReloadTimerRef.current);
    }

    autoReloadTimerRef.current = setTimeout(() => {
      saveDashboardStateAndReload();
    }, DASHBOARD_AUTO_RELOAD_MS);
  };

  const loadAllDashboardData = async (showLoading = false) => {
      if (running) return;

      running = true;

      try {
        await Promise.all([
          loadDashboardData(showLoading),
          loadOutdoorWeather(),
        ]);
      } finally {
        running = false;
      }
    };

    loadAllDashboardData(true);

    // Refresh data dashboard mỗi 10s, không reload trang
    const dashboardTimer = setInterval(() => {
      if (!alive) return;

      loadAllDashboardData(false);
    }, DASHBOARD_REFRESH_MS);

    // Bắt đầu đếm 10 phút không thao tác
    resetAutoReloadTimer();

    // Người dùng thao tác thì reset lại bộ đếm 10 phút
    const userEvents = [
      "mousemove",
      "mousedown",
      "keydown",
      "touchstart",
      "wheel",
      "scroll",
    ];

    userEvents.forEach((eventName) => {
      window.addEventListener(eventName, resetAutoReloadTimer, {
        passive: true,
      });
    });

    return () => {
      alive = false;

      clearInterval(dashboardTimer);

      if (autoReloadTimerRef.current) {
        clearTimeout(autoReloadTimerRef.current);
      }

      userEvents.forEach((eventName) => {
        window.removeEventListener(eventName, resetAutoReloadTimer);
      });
    };
  }, []);
  useEffect(() => {
    const restoreMachineSetting = async () => {
      if (!settingOpen || !selectedSettingMachine?.id) return;
      if (machineSetting) return;

      try {
        const res = await temperatureHumidityApi.getThresholdSetting(
          selectedSettingMachine.id
        );

        setMachineSetting(res.data || null);
      } catch (error) {
        console.error("Failed to restore machine setting:", error);
        setSettingOpen(false);
        setSelectedSettingMachine(null);
        setMachineSetting(null);
      }
    };

    restoreMachineSetting();
  }, [settingOpen, selectedSettingMachine, machineSetting]);
  const summary = useMemo(() => {
    const result = {
      normal: 0,
      warning: 0,
      alarm: 0,
      disconnected: 0,
    };

    machines.forEach((m) => {
      const status = getDisplayStatus(m);
      result[status] = (result[status] || 0) + 1;
    });

    return result;
  }, [machines]);

  const openAllChart = () => {
    setChartMode("all");
    setSelectedMachines(machineIds);
    setChartOpen(true);
    setActionMenuOpen(false);

    navigate("/chart");
  };
  const closeChart = () => {
    setChartOpen(false);

    if (defaultOpenChart) {
      navigate("/dashboard");
    }
  };
  const openWarningLog = () => {
    setSelectedLogMachine(null);
    setWarningLogOpen(true);
    setActionMenuOpen(false);
  };

  const openMachineSetting = async (machine) => {
    try {
      setSelectedSettingMachine(machine);
      setMachineSetting(null);

      const res = await temperatureHumidityApi.getThresholdSetting(machine.id);

      setMachineSetting(res.data || null);
      setSettingOpen(true);
    } catch (error) {
      console.error("Failed to load machine threshold setting:", error);
      alert("Unable to load this machine setting. Please check the API.");
    }
  };

  const closeMachineSetting = () => {
    setSettingOpen(false);
    setSelectedSettingMachine(null);
    setMachineSetting(null);
  };

  const toggleMachine = (id) => {
    if (chartMode === "single") return;

    setSelectedMachines((prev) => {
      const current = Array.isArray(prev) ? prev : [];

      return current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id].sort((a, b) => a - b);
    });
  };

  return (
    <Box
      sx={{
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        bgcolor: COLORS.bg,
        fontFamily: FONT_FAMILY,
        color: COLORS.head,
        display: "flex",
        flexDirection: "column",
        position: "relative",

        "&, & *": {
          fontFamily: `${FONT_FAMILY} !important`,
        },

        "& svg text": {
          fontFamily: `${FONT_FAMILY} !important`,
        },
      }}
    >
      <Box
        sx={{
          height: 64,
          flex: "0 0 64px",
          px: 2.5,
          bgcolor: COLORS.teal,
          color: COLORS.white,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 2,
          boxShadow: "0 4px 14px rgba(0,0,0,0.22)",
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.2,
            minWidth: 0,
          }}
        >
          <Typography
            sx={{
              fontSize: 20,
              fontWeight: 800,
              letterSpacing: 0,
              lineHeight: 1.1,
              whiteSpace: "nowrap",
            }}
          >
            TEMPERATURE & HUMIDITY
          </Typography>

          <HeaderWeatherBox
            icon="🌡️"
            label="Outdoor Temp"
            value={formatMetric(outdoorWeather.temp, "°C")}
          />

          <HeaderWeatherBox
            icon="💧"
            label="Outdoor Humidity"
            value={formatMetric(outdoorWeather.hum, "%")}
          />
        </Box>

        <Box
          sx={{
            display: "flex",
            gap: 1,
            alignItems: "center",
            minWidth: 0,
          }}
        >
          <SummaryChip
            label="Normal"
            value={summary.normal}
            icon="✅"
            color="#16a34a"
          />

          <SummaryChip
            label="Warning"
            value={summary.warning}
            icon="⚠️"
            color="#d97706"
          />

          <SummaryChip
            label="Alarm"
            value={summary.alarm}
            icon="🔴"
            color="#dc2626"
          />

          <SummaryChip
            label="No Data"
            value={summary.disconnected}
            icon="⚫"
            color="#6b7280"
          />

          <ClickAwayListener onClickAway={() => setActionMenuOpen(false)}>
            <Box
              sx={{
                position: "relative",
                display: "flex",
                alignItems: "center",
              }}
            >
              {actionMenuOpen && (
                <Paper
                  elevation={0}
                  sx={{
                    position: "absolute",
                    top: 48,
                    right: 0,
                    width: 190,
                    p: 1,
                    borderRadius: 3,
                    bgcolor: COLORS.white,
                    border: `1px solid ${COLORS.border}`,
                    boxShadow: "0 12px 30px rgba(15,23,42,0.22)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 0.8,
                    zIndex: 100,
                  }}
                >
                  <MenuActionButton
                    icon={<ShowChartIcon />}
                    label="Chart"
                    onClick={openAllChart}
                    color={COLORS.head}
                  />
                  <MenuActionButton
                    icon="⚠️"
                    label="History"
                    onClick={openWarningLog}
                    color={COLORS.head}
                  />
                </Paper>
              )}

              <IconButton
                onClick={() => setActionMenuOpen((prev) => !prev)}
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: 3,
                  bgcolor: COLORS.white,
                  color: COLORS.teal,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.16)",
                  "&:hover": {
                    bgcolor: "#e5e7eb",
                    transform: "translateY(-1px)",
                  },
                  transition: "0.18s ease",
                }}
              >
                <MenuIcon />
              </IconButton>
            </Box>
          </ClickAwayListener>
        </Box>
      </Box>

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          p: 1.4,
          display: "grid",
          gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
          gridAutoRows: "200px",
          gap: 1.15,
          mt: 2,
          overflowY: "auto",
          overflowX: "hidden",
        }}
      >
        {machines.length === 0 && (
          <Paper
            elevation={0}
            sx={{
              gridColumn: "1 / -1",
              height: 160,
              borderRadius: 3,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: COLORS.subtle,
              fontWeight: 700,
              border: `1px solid ${COLORS.border}`,
            }}
          >
            {loading ? "Loading machine data..." : "No machine data available"}
          </Paper>
        )}

        {machines.map((m) => {
          const status = getDisplayStatus(m);
          const s = statusStyle[status] || statusStyle.normal;
          const statusColor = getCardStatusColor(status);
          const machineDisplayName = m.code ? `${m.name}_${m.code}` : m.name;
          return (
            <Paper
              key={m.id}
              elevation={0}
              sx={{
                p: 1.15,
                borderRadius: 2.5,
                cursor: "default",
                border: `1px solid ${COLORS.border}`,
                borderTop: `5px solid ${statusColor}`,
                boxShadow: "0 4px 12px rgba(15,23,42,0.1)",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                minWidth: 0,
                minHeight: 0,
                overflow: "hidden",
                bgcolor: COLORS.white,
                position: "relative",
                transition: "0.18s ease",
                "&:hover": {
                  transform: "translateY(-2px)",
                  boxShadow: "0 8px 20px rgba(15,23,42,0.16)",
                  borderColor: statusColor,
                },
              }}
            >
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  openMachineSetting(m);
                }}
                sx={{
                  position: "absolute",
                  top: 7,
                  right: 7,
                  width: 28,
                  height: 28,
                  borderRadius: 2,
                  bgcolor: "#f8fafc",
                  color: COLORS.head,
                  border: `1px solid ${COLORS.border}`,
                  zIndex: 3,
                  "&:hover": {
                    bgcolor: COLORS.head,
                    color: COLORS.white,
                    borderColor: COLORS.head,
                  },
                }}
              >
                <SettingsIcon sx={{ fontSize: 17 }} />
              </IconButton>

              <Box
                sx={{
                  display: "flex",
                  justifyContent: "flex-start",
                  alignItems: "center",
                  gap: 0.45,
                  width: "100%",
                  pr: 4,
                }}
              >
                <Box
                  sx={{
                    bgcolor: "#f8fafc",
                    border: `1px solid ${statusColor}`,
                    px: 0.85,
                    py: 0.35,
                    borderRadius: 99,
                    fontWeight: 800,
                    color: statusColor,
                    fontSize: 12.5,
                    lineHeight: 1.1,
                    whiteSpace: "nowrap",
                    maxWidth: 115,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                  title={machineDisplayName}
                >
                  {machineDisplayName}
                </Box>
              </Box>

              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  gap: 0.65,
                  my: 0.8,
                  minHeight: 0,
                }}
              >
                <MetricBox
                  label="MOLD TEMP"
                  icon="🔥"
                  value={formatMetric(m.moldTemp, "°C")}
                />

                <MetricBox
                  label="TEMP"
                  icon="🌡️"
                  value={formatMetric(m.temp, "°C")}
                />

                <MetricBox
                  label="HUMIDITY"
                  icon="💧"
                  value={formatMetric(m.hum, "%")}
                />
              </Box>

              <Box
                sx={{
                  height: 26,
                  borderRadius: 99,
                  color: COLORS.white,
                  fontSize: 12.5,
                  fontWeight: 700,
                  textAlign: "center",
                  lineHeight: "26px",
                  background: s.bg,
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25)",
                }}
              >
                {s.icon} {s.label}
              </Box>
            </Paper>
          );
        })}
      </Box>

      <ThresholdSettingDialog
        open={settingOpen}
        onClose={closeMachineSetting}
        machine={selectedSettingMachine}
        setting={machineSetting}
        colors={COLORS}
        fontFamily={FONT_FAMILY}
        onSave={async (newSetting) => {
          if (!selectedSettingMachine?.id) return;

          await temperatureHumidityApi.updateThresholdSetting({
            ...newSetting,
            machineId: selectedSettingMachine.id,
          });

          loadDashboardData(false);
        }}
      />
      <MachineChartDialog
        open={chartOpen}
        onClose={closeChart}
        chartMode={chartMode}
        machines={machines}
        selectedMachines={selectedMachines || []}
        setSelectedMachines={setSelectedMachines}
        toggleMachine={toggleMachine}
        machineIds={machineIds}
        machineColors={MACHINE_COLORS}
        colors={COLORS}
        fontFamily={FONT_FAMILY}
      />

      <WarningLogDialog
        open={warningLogOpen}
        onClose={() => {
          setWarningLogOpen(false);
          setSelectedLogMachine(null);
        }}
        colors={COLORS}
        fontFamily={FONT_FAMILY}
        selectedMachine={selectedLogMachine}
      />
    </Box>
  );
}

function SummaryChip({ label, value, icon, color }) {
  return (
    <Chip
      label={`${icon} ${label}: ${value}`}
      sx={{
        height: 32,
        bgcolor: COLORS.white,
        color,
        fontSize: 13,
        fontWeight: 700,
        border: `1px solid ${color}`,
        "& .MuiChip-label": { px: 1.25 },
      }}
    />
  );
}

function HeaderWeatherBox({ icon, label, value }) {
  return (
    <Box
      sx={{
        height: 40,
        px: 1.25,
        borderRadius: 2,
        bgcolor: "rgba(255,255,255,0.14)",
        border: "1px solid rgba(255,255,255,0.32)",
        display: "flex",
        alignItems: "center",
        gap: 0.8,
        minWidth: 145,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.16)",
      }}
    >
      <Box component="span" sx={{ fontSize: 18, lineHeight: 1 }}>
        {icon}
      </Box>

      <Box sx={{ minWidth: 0 }}>
        <Typography
          sx={{
            fontSize: 10.5,
            fontWeight: 700,
            lineHeight: 1.1,
            color: "rgba(255,255,255,0.78)",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </Typography>

        <Typography
          sx={{
            fontSize: 16,
            fontWeight: 900,
            lineHeight: 1.1,
            color: COLORS.white,
            whiteSpace: "nowrap",
          }}
        >
          {value}
        </Typography>
      </Box>
    </Box>
  );
}

function MetricBox({ label, icon, value }) {
  return (
    <Box
      sx={{
        border: `1px solid ${COLORS.border}`,
        bgcolor: "#f8fafc",
        borderRadius: 2,
        textAlign: "center",
        py: 0.8,
        px: 0.45,
        minWidth: 0,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.8)",
      }}
    >
      <Typography
        sx={{
          fontSize: 10,
          color: COLORS.subtle,
          fontWeight: 800,
          lineHeight: 1.1,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {icon} {label}
      </Typography>

      <Typography
        sx={{
          fontSize: 18,
          fontWeight: 900,
          color: COLORS.head,
          lineHeight: 1.15,
          mt: 0.45,
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}

function MenuActionButton({ icon, label, onClick, color }) {
  return (
    <Button
      fullWidth
      onClick={onClick}
      startIcon={
        typeof icon === "string" ? (
          <Box component="span" sx={{ fontSize: 17, lineHeight: 1 }}>
            {icon}
          </Box>
        ) : (
          icon
        )
      }
      sx={{
        height: 40,
        justifyContent: "flex-start",
        px: 1.4,
        borderRadius: 2,
        bgcolor: "#f8fafc",
        color,
        border: `1px solid ${COLORS.border}`,
        fontSize: 14,
        fontWeight: 800,
        textTransform: "none",
        "& .MuiButton-startIcon": {
          mr: 1,
        },
        "&:hover": {
          bgcolor: color,
          color: COLORS.white,
          borderColor: color,
        },
      }}
    >
      {label}
    </Button>
  );
}