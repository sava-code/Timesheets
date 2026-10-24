import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installDevApi } from "./devApi";
import "./fonts.css";
import "./styles.css";

// Outside Electron (npm run dev:web) use an in-memory demo backend.
installDevApi();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
