import axios from "axios";

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://10.73.132.115:5001";

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: {
    "Content-Type": "application/json",
  },
});

export const temperatureHumidityApi = {
  // Lấy danh sách máy + dữ liệu mới nhất
  getLatestMachines: () => {
    return api.get("/api/machines/latest");
  },

  // Lấy setting ngưỡng cảnh báo
  getThresholdSetting: (machineId) =>
  api.get("/api/settings/threshold", {
    params: { machineId },
  }),

  // Lưu setting ngưỡng cảnh báo
  updateThresholdSetting: (data) =>
  api.put("/api/settings/threshold", data),


  // Lấy danh sách mốc chart 10s / 30s / 60s
  getChartTimeSettings: () => {
    return api.get("/api/settings/chart-times");
  },

  // Lấy dữ liệu chart
  getChartData: ({
    interval = 10,
    points = 100,
    startTime = "",
    endTime = "",
  } = {}) => {
    const params = {
      interval,
      points,
    };

    if (startTime) {
      params.startTime = startTime;
    }

    if (endTime) {
      params.endTime = endTime;
    }

    return api.get("/api/sensor-readings/chart", {
      params,
    });
  },

  // Lấy log warning/alarm
  getWarningLogs: ({
    status = "all",
    date = "",
    machine = "",
    machineId = "",
    onlyActive = "",
    limit = 300,
  } = {}) => {
    return api.get("/api/warning-logs", {
      params: {
        status,
        date,
        machine,
        machineId,
        onlyActive,
        limit,
      },
    });
  },

  // Xoá warning/alarm logs
  deleteWarningLogs: () => {
    return api.delete("/api/warning-logs");
  },
  getOutdoorWeatherLatest: () => {
    return api.get("/api/outdoor-weather/latest");
  },
  createOutdoorWeather: ({ temp, hum }) => {
    return api.post("/api/outdoor-weather", {
        temp,
        hum,
    });
    },
  confirmWarningLog: (logId, confirmedBy = "operator") => {
    return api.put(`/api/warning-logs/${logId}/confirm`, {
      confirmedBy,
    });
  },

  confirmMachineAlerts: (machineId, confirmedBy = "operator") => {
    return api.put(`/api/machines/${machineId}/confirm-alerts`, {
      confirmedBy,
    });
  },
  // API test dữ liệu fake
  createFakeSensorReadings: () => {
    return api.post("/api/sensor-readings/fake");
  },

  createFakeHistory: ({ minutes = 60, stepSeconds = 10 } = {}) => {
    return api.post("/api/sensor-readings/fake-history", {
      minutes,
      stepSeconds,
    });
  },
};

export default api;