import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import TemperatureHumidityDashboard from "./layout/TemperatureHumidityDashboard";
import WarningLogPage from "./layout/WarningLogPage";

export default function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<TemperatureHumidityDashboard />} />
      <Route
        path="/chart"
        element={<TemperatureHumidityDashboard defaultOpenChart />}
      />

      <Route path="/warning-log" element={<WarningLogPage />} />
    </Routes>
  );
}