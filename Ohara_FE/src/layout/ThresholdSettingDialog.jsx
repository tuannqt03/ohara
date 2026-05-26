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
import RestartAltIcon from "@mui/icons-material/RestartAlt";

const defaultSetting = {
  moldTempBase: 70,
  moldTempWarningDelta: 2,
  moldTempAlarmDelta: 4,

  envTempBase: 25,
  envTempWarningDelta: 2,
  envTempAlarmDelta: 4,

  humidityBase: 50,
  humidityWarningDelta: 5,
  humidityAlarmDelta: 10,
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
  const [draftSetting, setDraftSetting] = useState(defaultSetting);

  useEffect(() => {
    if (!open) return;

    setDraftSetting({
      ...defaultSetting,
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

  const renderNumberInput = ({ keyName, unit }) => (
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
  );

  return (
    <Dialog
      open={open}
      onClose={saving ? undefined : onClose}
      maxWidth="md"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            width: 720,
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
                color: "#fff",
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
                {column.icon} {column.shortTitle} ({column.unit})
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
                minHeight: 68,
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
                  {row.icon} {row.label}
                </Typography>

                <Typography
                  sx={{
                    mt: 0.35,
                    fontFamily,
                    fontSize: 11.5,
                    fontWeight: 700,
                    color: colors.subtle,
                  }}
                >
                  {row.note}
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
