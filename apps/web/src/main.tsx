import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";

const rootElement = document.querySelector("#root");

if (!rootElement) {
  throw new Error("Missing application root element");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
