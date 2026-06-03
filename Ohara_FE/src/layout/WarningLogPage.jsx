import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Dialog,
  DialogContent,
  IconButton,
  Paper,
  Typography,
  Chip,
  TextField,
  MenuItem,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";

import { temperatureHumidityApi } from "../config/api";

const DEFAULT_COLORS = {
  head: "#212222",
  subtle: "#6b7280",
  border: "#d9e2ec",
  bg: "#eef3f8",
  white: "#ffffff",
  warning: "#d97706",
  alarm: "#dc2626",
  teal: "#075f68",
};

const DEFAULT_FONT_FAMILY = '"Roboto", "Arial", sans-serif';

const getTodayInputDate = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const getInputDateFromLogTime = (value) => {
  if (!value) return "";

  const text = String(value).trim();
  const datePart = text.split(" ")[0];

  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    return datePart;
  }

  const date = new Date(text.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const sortLogsNewestFirst = (items) => {
  return [...items].sort((a, b) => {
    const timeA = new Date(String(a.time || "").replace(" ", "T")).getTime();
    const timeB = new Date(String(b.time || "").replace(" ", "T")).getTime();

    return (Number.isNaN(timeB) ? 0 : timeB) - (Number.isNaN(timeA) ? 0 : timeA);
  });
};

const formatDateTime = (value) => {
  if (!value) return "";

  const date = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour12: false,
  });
};
const getWarningDescription = (item) => {
  return item.message || "Threshold exceeded";
};
export default function WarningLogDialog({
  open,
  onClose,
  colors = DEFAULT_COLORS,
  fontFamily = DEFAULT_FONT_FAMILY,
  selectedMachine = null,
}) {
  const COLORS = {
    ...DEFAULT_COLORS,
    ...colors,
    warning: colors.warning || DEFAULT_COLORS.warning,
    alarm: colors.alarm || DEFAULT_COLORS.alarm,
    teal: colors.teal || DEFAULT_COLORS.teal,
  };

  const [logs, setLogs] = useState([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchMachine, setSearchMachine] = useState("");
  const [fromDate, setFromDate] = useState(getTodayInputDate());
  const [dateReady, setDateReady] = useState(false);
  const [loading, setLoading] = useState(false);

  const resolveInitialDate = async () => {
    const today = getTodayInputDate();

    if (!selectedMachine?.id) {
      setFromDate(today);
      setDateReady(true);
      return;
    }

    try {
      setLoading(true);

      const res = await temperatureHumidityApi.getWarningLogs({
        status: "all",
        date: "",
        machine: "",
        machineId: selectedMachine.id,
      });

      const allLogs = Array.isArray(res.data) ? res.data : [];
      const sortedLogs = sortLogsNewestFirst(allLogs);

      const hasTodayLog = sortedLogs.some(
        (log) => getInputDateFromLogTime(log.time) === today
      );

      if (hasTodayLog) {
        setFromDate(today);
        return;
      }

      const activeLogById = selectedMachine?.activeLogId
        ? sortedLogs.find(
            (log) => Number(log.id) === Number(selectedMachine.activeLogId)
          )
        : null;

      if (activeLogById) {
        const activeDate = getInputDateFromLogTime(activeLogById.time);
        setFromDate(activeDate || today);
        return;
      }

      if (sortedLogs.length > 0) {
        const latestDate = getInputDateFromLogTime(sortedLogs[0].time);
        setFromDate(latestDate || today);
        return;
      }

      setFromDate(today);
    } catch (error) {
      console.error("Failed to resolve initial log date:", error);
      setFromDate(today);
    } finally {
      setDateReady(true);
      setLoading(false);
    }
  };

  const loadLogs = async () => {
    if (!dateReady) return;

    try {
      setLoading(true);

      const res = await temperatureHumidityApi.getWarningLogs({
        status: statusFilter,
        date: fromDate,
        machine: searchMachine,
        machineId: selectedMachine?.id || "",
      });

      setLogs(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      console.error("Failed to load warning logs:", error);
      setLogs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) {
      setDateReady(false);
      return;
    }

    setLogs([]);
    setStatusFilter("all");
    setSearchMachine("");
    setDateReady(false);

    resolveInitialDate();
  }, [open, selectedMachine?.id, selectedMachine?.activeLogId]);

  useEffect(() => {
    if (!open || !dateReady) return;

    loadLogs();

    const timer = setInterval(loadLogs, 5000);

    return () => clearInterval(timer);
  }, [open, dateReady, statusFilter, fromDate, searchMachine, selectedMachine?.id]);

  const warningCount = useMemo(
    () => logs.filter((x) => x.status === "warning").length,
    [logs]
  );

  const alarmCount = useMemo(
    () => logs.filter((x) => x.status === "alarm").length,
    [logs]
  );

  const columnTemplate =
    "70px 220px minmax(150px, 1fr) minmax(260px, 1.3fr) 150px 180px 120px 120px";

  const title = selectedMachine
    ? `WARNING & ALARM LOG - ${selectedMachine.name}`
    : "WARNING & ALARM HISTORY";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      slotProps={{
        paper: {
          sx: {
            width: "min(1720px, 98vw)",
            height: "96vh",
            maxHeight: "96vh",
            minHeight: "96vh",
            borderRadius: 3,
            overflow: "hidden",
            bgcolor: COLORS.bg,
            boxShadow: "0 24px 70px rgba(0,0,0,0.35)",
            fontFamily,
          },
        },
        backdrop: {
          sx: {
            bgcolor: "rgba(0,0,0,0.48)",
            backdropFilter: "blur(1px)",
          },
        },
      }}
    >
      <DialogContent
        sx={{
          p: 0,
          height: "100%",
          display: "flex",
          flexDirection: "column",

          "&, & *": {
            fontFamily: `${fontFamily} !important`,
          },
        }}
      >
        <Paper
          elevation={0}
          sx={{
            p: 1.5,
            borderRadius: 0,
            borderBottom: `1px solid ${COLORS.border}`,
            bgcolor: COLORS.teal,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 2,
            flexShrink: 0,
            mb: 1,
          }}
        >
          <Box>
            <Typography
              sx={{
                fontSize: 20,
                fontWeight: 800,
                color: COLORS.white,
                lineHeight: 1.2,
              }}
            >
              {title}
            </Typography>
          </Box>

          <Box
            sx={{
              display: "flex",
              gap: 1,
              alignItems: "center",
              flexShrink: 0,
            }}
          >
            <Chip
              label={`Warning: ${warningCount}`}
              sx={{
                color: COLORS.warning,
                border: `1px solid ${COLORS.warning}`,
                bgcolor: COLORS.white,
                fontWeight: 700,
              }}
            />

            <Chip
              label={`Alarm: ${alarmCount}`}
              sx={{
                color: COLORS.alarm,
                border: `1px solid ${COLORS.alarm}`,
                bgcolor: COLORS.white,
                fontWeight: 700,
              }}
            />
            <IconButton
              onClick={onClose}
              sx={{
                width: 36,
                height: 36,
                color: COLORS.white,
                "&:hover": {
                  bgcolor: "#363636",
                },
              }}
            >
              <CloseIcon />
            </IconButton>
          </Box>
        </Paper>

        <Paper
          elevation={0}
          sx={{
            p: 1.2,
            borderRadius: 0,
            borderBottom: `1px solid ${COLORS.border}`,
            bgcolor: COLORS.white,
            display: "flex",
            gap: 1.5,
            alignItems: "center",
            flexWrap: "wrap",
            flexShrink: 0,
          }}
        >
          {!selectedMachine && (
            <TextField
              size="small"
              label="Search by machine name"
              value={searchMachine}
              onChange={(e) => setSearchMachine(e.target.value)}
              sx={{
                width: 210,
                "& .MuiOutlinedInput-root": {
                  borderRadius: 2,
                },
              }}
            />
          )}

          <TextField
            size="small"
            select
            label="Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            sx={{
              width: 150,
              "& .MuiOutlinedInput-root": {
                borderRadius: 2,
              },
            }}
          >
            <MenuItem value="all">All</MenuItem>
            <MenuItem value="warning">Warning</MenuItem>
            <MenuItem value="alarm">Alarm</MenuItem>
          </TextField>

          <TextField
            size="small"
            type="date"
            label="Date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            slotProps={{
              inputLabel: {
                shrink: true,
              },
              htmlInput: {
                max: getTodayInputDate(),
              },
            }}
            sx={{
              width: 150,
              "& .MuiOutlinedInput-root": {
                borderRadius: 2,
              },
              "& input": {
                cursor: "pointer",
              },
            }}
          />
          <Box sx={{ flex: 1 }} />
        </Paper>

        <Paper
          elevation={0}
          sx={{
            height: "800px",
            minHeight: "715px",
            maxHeight: "800px",
            m: 1.2,
            borderRadius: 2.5,
            border: `1px solid ${COLORS.border}`,
            bgcolor: COLORS.white,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: columnTemplate,
              width: "100%",
              bgcolor: "#f8fafc",
              borderBottom: `1px solid ${COLORS.border}`,
              height: 42,
              minHeight: 42,
              alignItems: "center",
              flexShrink: 0,
              position: "sticky",
              top: 0,
              zIndex: 3,
            }}
          >
            {[
              "No.",
              "Time",
              "Machine Name",
              "Description",
              "Mold Temp",
              "Temp",
              "Humidity",
              "Status",
            ].map((head) => {
              const centerHeaders = ["Mold Temp", "Temp", "Humidity", "Status"];

              return (
                <Typography
                  key={head}
                  sx={{
                    px: 1.2,
                    fontSize: 13,
                    fontWeight: 800,
                    color: COLORS.head,
                    textAlign: centerHeaders.includes(head) ? "center" : "left",
                    whiteSpace: "nowrap",
                  }}
                >
                  {head}
                </Typography>
              );
            })}
          </Box>

          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              overflow: "auto",
              overflowX: "hidden",
            }}
          >
            {logs.length === 0 ? (
              <Typography
                sx={{
                  p: 3,
                  textAlign: "center",
                  color: COLORS.subtle,
                  fontSize: 14,
                }}
              >
                {loading ? "Loading warning logs..." : "No warning logs found"}
              </Typography>
            ) : (
              logs.map((item, index) => {
                const isAlarm = item.status === "alarm";

                const rowBg = isAlarm ? "#fef2f2" : "#fff7ed";
                const rowHoverBg = isAlarm ? "#fee2e2" : "#ffedd5";
                const statusColor = isAlarm ? COLORS.alarm : COLORS.warning;

                return (
                  <Box
                    key={item.id || `${item.machineName}-${item.time}-${index}`}
                    sx={{
                      display: "grid",
                      gridTemplateColumns: columnTemplate,
                      width: "100%",
                      bgcolor: rowBg,
                      minHeight: 42,
                      alignItems: "center",
                      transition: "0.18s ease",
                      "&:hover": {
                        bgcolor: rowHoverBg,
                        opacity: 1,
                      },
                    }}
                  >
                    <Cell colors={COLORS}>
                      {index + 1}
                    </Cell>

                    <Cell colors={COLORS} bold>
                      {formatDateTime(item.time)}
                    </Cell>

                    <Cell colors={COLORS} bold>
                      {item.machineName}
                    </Cell>

                    <Cell colors={COLORS}>
                      {getWarningDescription(item)}
                    </Cell>

                    <Cell colors={COLORS} bold align="center">
                      {item.moldTemp}°C
                    </Cell>

                    <Cell colors={COLORS} bold align="center">
                      {item.envTemp}°C
                    </Cell>

                    <Cell colors={COLORS} bold align="center">
                      {item.hum}%
                    </Cell>

                    <Box
                      sx={{
                        px: 1.2,
                        display: "flex",
                        justifyContent: "center",
                      }}
                    >
                      <Chip
                        label={isAlarm ? "Alarm" : "Warning"}
                        size="small"
                        sx={{
                          minWidth: 86,
                          color: COLORS.white,
                          border: `1px solid ${statusColor}`,
                          bgcolor: statusColor,
                          fontWeight: 800,
                        }}
                      />
                    </Box>
                  </Box>
                );
              })
            )}
          </Box>
        </Paper>
      </DialogContent>
    </Dialog>
  );
}

function Cell({ children, bold = false, align = "left", colors, muted = false }) {
  return (
    <Typography
      sx={{
        px: 1.2,
        fontSize: 13,
        fontWeight: bold ? 800 : 600,
        color: muted ? "#6b7280" : colors.head,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        textAlign: align,
      }}
    >
      {children}
    </Typography>
  );
}