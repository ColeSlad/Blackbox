import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "./App.js";

describe("App", () => {
  it("server-renders the application shell", () => {
    const html = renderToString(<App />);

    expect(html).toContain("<h1>Blackbox</h1>");
    expect(html).toContain("Transactional runtime");
  });
});
