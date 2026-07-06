import React from "react";
import ReactDOM from "react-dom/client";
import { installGlobalErrorLogging } from "./logging";
import Wallpaper from "./Wallpaper";

installGlobalErrorLogging("wallpaper");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Wallpaper />
  </React.StrictMode>
);
