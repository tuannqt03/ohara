import React, { useEffect, useState } from "react";
import {
  Box,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  IconButton,
  Button,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import SaveIcon from "@mui/icons-material/Save";

const emptySetting = {
  moldTempBase: "",
  moldTempWarningDelta: "",
  moldTempAlarmDelta: "",

  envTempBase: "",
  envTempWarningDelta: "",
  envTempAlarmDelta: "",

  humidityBase: "",
  humidityWarningDelta: "",
  humidityAlarmDelta: "",
};

const thresholdColumns = [
  {
    title: "Mold Temperature",
    shortTitle: "Mold Temp",
    unit: "°C",
    baseKey: "moldTempBase",
    warningKey: "moldTempWarningDelta",
    alarmKey: "moldTempAlarmDelta",
  },
  {
    title: "Ambient Temperature",
    shortTitle: "Ambient Temp",
    unit: "°C",
    baseKey: "envTempBase",
    warningKey: "envTempWarningDelta",
    alarmKey: "envTempAlarmDelta",
  },
  {
    title: "Humidity",
    shortTitle: "Humidity",
    unit: "%",
    baseKey: "humidityBase",
    warningKey: "humidityWarningDelta",
    alarmKey: "humidityAlarmDelta",
  },
];

const thresholdRows = [
  {
    label: "Initial value",
    keyType: "baseKey",
  },
  {
    label: "Warning range (±)",
    keyType: "warningKey",
  },
  {
    label: "Alarm range (±)",
    keyType: "alarmKey",
  },
];

const toNumber = (value) => Number(value);

const formatNumber = (value) => {
  const num = Number(value);

  if (Number.isNaN(num)) return "--";

  return Number.isInteger(num) ? String(num) : String(Number(num.toFixed(1)));
};

const getLimitText = ({ base, delta, type, unit }) => {
  const baseValue = Number(base);
  const deltaValue = Number(delta);

  if (
    Number.isNaN(baseValue) ||
    Number.isNaN(deltaValue) ||
    deltaValue <= 0
  ) {
    return "";
  }

  const low = baseValue - deltaValue;
  const high = baseValue + deltaValue;

  return `${type}: ≤ ${formatNumber(low)}${unit} or ≥ ${formatNumber(high)}${unit}`;
};

export default function ThresholdSettingDialog({
  open,
  onClose,
  machine,
  setting,
  colors,
  fontFamily,
  onSave,
}) {
  const [saving, setSaving] = useState(false);
  const [draftSetting, setDraftSetting] = useState(emptySetting);

  useEffect(() => {
    if (!open) return;

    setDraftSetting({
      ...emptySetting,
      ...(setting || {}),
    });
  }, [open, setting]);

  const validateGroup = (base, warningDelta, alarmDelta, label) => {
    const baseValue = toNumber(base);
    const warningValue = toNumber(warningDelta);
    const alarmValue = toNumber(alarmDelta);

    if (
      Number.isNaN(baseValue) ||
      Number.isNaN(warningValue) ||
      Number.isNaN(alarmValue)
    ) {
      return `${label}: please enter Initial value, Warning ± and Alarm ± values.`;
    }

    if (warningValue <= 0 || alarmValue <= 0) {
      return `${label}: Warning ± and Alarm ± must be greater than 0.`;
    }

    if (warningValue >= alarmValue) {
      return `${label}: Alarm ± must be greater than Warning ±.`;
    }

    return "";
  };

  const handleSave = async () => {
    const errorMessage = thresholdColumns
      .map((column) =>
        validateGroup(
          draftSetting[column.baseKey],
          draftSetting[column.warningKey],
          draftSetting[column.alarmKey],
          column.title
        )
      )
      .find(Boolean);

    if (errorMessage) {
      alert(errorMessage);
      return;
    }

    try {
      setSaving(true);

      if (onSave) {
        await onSave(draftSetting);
      }

      onClose();
    } catch (error) {
      console.error("Failed to save settings:", error);
      alert("Failed to save settings. Please check the API.");
    } finally {
      setSaving(false);
    }
  };

  const handleChangeValue = (key, value) => {
    setDraftSetting((prev) => ({
      ...prev,
      [key]: value === "" ? "" : Number(value),
    }));
  };

  const renderNumberInput = ({ keyName, unit, column, row }) => {
    const isWarningRow = row.keyType === "warningKey";
    const isAlarmRow = row.keyType === "alarmKey";

    const helperText =
      isWarningRow || isAlarmRow
        ? getLimitText({
            base: draftSetting[column.baseKey],
            delta: draftSetting[column[row.keyType]],
            type: isWarningRow ? "Warning" : "Alarm",
            unit,
          })
        : "";

    return (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          minHeight: helperText ? 56 : 38,
        }}
      >
        <TextField
          type="number"
          size="small"
          value={draftSetting?.[keyName] ?? ""}
          disabled={saving}
          onChange={(e) => handleChangeValue(keyName, e.target.value)}
          slotProps={{
            htmlInput: {
              step: "0.1",
              style: {
                height: 34,
                padding: "0 10px",
                textAlign: "center",
                fontFamily,
                fontSize: 14,
                fontWeight: 800,
                color: colors.head,
              },
            },
          }}
          InputProps={{
            endAdornment: (
              <Typography
                sx={{
                  ml: 0.7,
                  fontFamily,
                  fontSize: 11,
                  fontWeight: 800,
                  color: colors.subtle,
                }}
              >
                {unit}
              </Typography>
            ),
          }}
          sx={{
            width: 112,
            "& .MuiOutlinedInput-root": {
              height: 38,
              borderRadius: 1.4,
              bgcolor: "#ffffff",
              "& fieldset": {
                borderColor: colors.border,
              },
              "&:hover fieldset": {
                borderColor: "#94a3b8",
              },
              "&.Mui-focused fieldset": {
                borderColor: "#3b82f6",
                borderWidth: 1.5,
              },
            },
          }}
        />

        {helperText && (
          <Typography
            sx={{
              mt: 0.45,
              fontFamily,
              fontSize: 10.5,
              fontWeight: 800,
              color: isAlarmRow ? "#b91c1c" : "#b45309",
              lineHeight: 1.2,
              textAlign: "center",
              whiteSpace: "nowrap",
            }}
          >
            {helperText}
          </Typography>
        )}
      </Box>
    );
  };

  return (
    <Dialog
      open={open}
      onClose={saving ? undefined : onClose}
      maxWidth="md"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            width: 760,
            maxWidth: "calc(100vw - 32px)",
            borderRadius: 2.5,
            overflow: "hidden",
            bgcolor: "#f8fafc",
          },
        },
      }}
    >
      <DialogTitle
        sx={{
          height: 58,
          bgcolor: colors.teal,
          color: colors.white,
          fontFamily,
          fontSize: 18,
          fontWeight: 900,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          py: 0,
          px: 2.5,
          mb: 2,
        }}
      >
        <Box
          sx={{
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          MACHINE THRESHOLD SETTINGS
          {machine?.name ? ` - ${machine.name}` : ""}
        </Box>

        <IconButton
          onClick={onClose}
          disabled={saving}
          sx={{ color: colors.white }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent
        sx={{
          px: 2.5,
          py: 2.5,
          bgcolor: "#f8fafc",
        }}
      >
        <Box
          sx={{
            border: `1px solid ${colors.border}`,
            borderRadius: 2,
            overflow: "hidden",
            bgcolor: "#ffffff",
          }}
        >
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "1.2fr repeat(3, 1fr)",
              alignItems: "center",
              minHeight: 54,
              px: 1.5,
              bgcolor: "#ffffff",
              borderBottom: `1px solid ${colors.border}`,
            }}
          >
            <Typography
              sx={{
                fontFamily,
                fontSize: 13,
                fontWeight: 900,
                color: colors.subtle,
              }}
            >
              Parameter
            </Typography>

            {thresholdColumns.map((column) => (
              <Typography
                key={column.title}
                sx={{
                  fontFamily,
                  fontSize: 13,
                  fontWeight: 900,
                  color: colors.subtle,
                  textAlign: "center",
                }}
              >
                {column.shortTitle} ({column.unit})
              </Typography>
            ))}
          </Box>

          {thresholdRows.map((row, rowIndex) => (
            <Box
              key={row.label}
              sx={{
                display: "grid",
                gridTemplateColumns: "1.2fr repeat(3, 1fr)",
                alignItems: "center",
                minHeight: row.keyType === "baseKey" ? 68 : 82,
                px: 1.5,
                borderBottom:
                  rowIndex !== thresholdRows.length - 1
                    ? `1px solid ${colors.border}`
                    : "none",
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  sx={{
                    fontFamily,
                    fontSize: 14,
                    fontWeight: 900,
                    color: colors.head,
                    lineHeight: 1.25,
                  }}
                >
                  {row.label}
                </Typography>
              </Box>

              {thresholdColumns.map((column) => (
                <Box
                  key={`${row.label}-${column.title}`}
                  sx={{ display: "flex", justifyContent: "center" }}
                >
                  {renderNumberInput({
                    keyName: column[row.keyType],
                    unit: column.unit,
                    column,
                    row,
                  })}
                </Box>
              ))}
            </Box>
          ))}
        </Box>


      </DialogContent>

      <DialogActions
        sx={{
          px: 2.5,
          pb: 2,
          pt: 1.6,
          bgcolor: "#f8fafc",
          borderTop: `1px solid ${colors.border}`,
          justifyContent: "flex-end",
          gap: 1.2,
        }}
      >
        <Button
          startIcon={<SaveIcon />}
          onClick={handleSave}
          disabled={saving}
          sx={{
            height: 40,
            px: 2.5,
            borderRadius: 1.7,
            textTransform: "none",
            bgcolor: "#070707",
            color: colors.white,
            fontFamily,
            fontWeight: 900,
            opacity: saving ? 0.65 : 1,
            boxShadow: "none",
            "&:hover": {
              bgcolor: "#000000",
            },
            "&.Mui-disabled": {
              bgcolor: "#000000",
              color: colors.white,
            },
          }}
        >
          {saving ? "Saving..." : "Save Settings"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}