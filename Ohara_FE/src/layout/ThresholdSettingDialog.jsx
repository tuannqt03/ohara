import React, { useEffect, useRef, useState } from "react";
import {
  Box,
  Paper,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  IconButton,
  Button,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import SaveIcon from "@mui/icons-material/Save";

const fieldLabel = {
  warningMoldTemp: "Mold temperature warning",
  alarmMoldTemp: "Mold temperature alarm",
  warningTemp: "Ambient temperature warning",
  alarmTemp: "Ambient temperature alarm",
  warningHum: "Humidity warning",
  alarmHum: "Humidity alarm",
};

const fieldUnit = {
  warningMoldTemp: "°C",
  alarmMoldTemp: "°C",
  warningTemp: "°C",
  alarmTemp: "°C",
  warningHum: "%",
  alarmHum: "%",
};

const fieldKeys = [
  "warningMoldTemp",
  "alarmMoldTemp",
  "warningTemp",
  "alarmTemp",
  "warningHum",
  "alarmHum",
];

export default function ThresholdSettingDialog({
  open,
  onClose,
  setting,
  colors,
  fontFamily,
  onSave,
}) {
  const [saving, setSaving] = useState(false);
  const [draftSetting, setDraftSetting] = useState(setting);

  const wasOpenRef = useRef(false);

  useEffect(() => {
    const justOpened = open && !wasOpenRef.current;

    if (justOpened) {
      setDraftSetting(setting);
    }

    wasOpenRef.current = open;
  }, [open, setting]);

  const handleSave = async () => {
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

  return (
    <Dialog
      open={open}
      onClose={saving ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            borderRadius: 3,
            overflow: "hidden",
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
          fontWeight: 700,
          letterSpacing: 0,
          lineHeight: "58px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          py: 0,
          px: 2.5,
        }}
      >
        TEMPERATURE & HUMIDITY SETTINGS

        <IconButton
          onClick={onClose}
          disabled={saving}
          sx={{ color: colors.white }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ p: 2.5 }}>
        <Paper
          elevation={0}
          sx={{
            p: 1,
            mt: 1,
          }}
        >
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 1.2,
            }}
          >
            {fieldKeys.map((key) => (
              <TextField
                key={key}
                type="number"
                label={`${fieldLabel[key]} (${fieldUnit[key]})`}
                value={draftSetting?.[key] ?? ""}
                disabled={saving}
                onChange={(e) => {
                  const value = e.target.value;

                  setDraftSetting((prev) => ({
                    ...prev,
                    [key]: value === "" ? "" : Number(value),
                  }));
                }}
                slotProps={{
                  inputLabel: {
                    sx: {
                      fontFamily,
                      fontSize: 13,
                      fontWeight: 500,
                      color: colors.subtle,
                      "&.Mui-focused": {
                        color: colors.head,
                        fontWeight: 600,
                      },
                    },
                  },
                  htmlInput: {
                    style: {
                      fontFamily,
                      fontSize: 16,
                      fontWeight: 500,
                      color: colors.head,
                      padding: "14px 12px",
                    },
                  },
                }}
                sx={{
                  mt: 2.5,
                  "& .MuiOutlinedInput-root": {
                    borderRadius: 2.5,
                    bgcolor: colors.white,
                    "& fieldset": {
                      borderColor: colors.border,
                      borderWidth: 1.4,
                    },
                    "&:hover fieldset": { borderColor: colors.head },
                    "&.Mui-focused fieldset": {
                      borderColor: colors.head,
                      borderWidth: 1.6,
                    },
                  },
                }}
              />
            ))}
          </Box>
        </Paper>
      </DialogContent>

      <DialogActions
        sx={{
          px: 2.5,
          pb: 2.5,
          pt: 0,
          display: "flex",
          justifyContent: "flex-end",
          gap: 1,
        }}
      >
        <Button
          startIcon={<SaveIcon />}
          onClick={handleSave}
          disabled={saving}
          sx={{
            height: 38,
            px: 2.5,
            borderRadius: 2,
            textTransform: "none",
            bgcolor: colors.head,
            color: colors.white,
            fontFamily,
            fontWeight: 800,
            opacity: saving ? 0.65 : 1,
            "&:hover": {
              bgcolor: "#111827",
            },
            "&.Mui-disabled": {
              bgcolor: colors.head,
              color: colors.white,
            },
          }}
        >
          {saving ? "Saving..." : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}