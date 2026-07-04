import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { OpenRoadErrorBoundary } from "./app/OpenRoadErrorBoundary";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <OpenRoadErrorBoundary>
      <App />
    </OpenRoadErrorBoundary>
  </React.StrictMode>
);
