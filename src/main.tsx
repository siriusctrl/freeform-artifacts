import { StrictMode } from "react";
import * as React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist/wght.css";
import "@fontsource-variable/geist-mono/wght.css";
import App from "./App";
import "./styles.css";

window.React = React;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

declare global {
  interface Window {
    React: typeof React;
  }
}
