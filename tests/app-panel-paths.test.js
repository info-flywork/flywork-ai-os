import { describe, expect, it } from "vitest";

import { prefixPanelLocation, prefixPanelPaths } from "../src/lib/appPanelPaths.js";

describe("app panel paths", () => {
  it("prefixes root paths the panel page requests", () => {
    const html = `<link rel="stylesheet" href="/css/panel-shell.css" /><script src="/js/panel-auth.js"></script>`;
    const script = 'await fetch("/api/apps"); window.location.href = "/login.html"; fetch(`/api/apps/${id}`)';
    expect(prefixPanelPaths(html)).toContain('href="/uygulama-paneli/css/panel-shell.css"');
    expect(prefixPanelPaths(html)).toContain('src="/uygulama-paneli/js/panel-auth.js"');
    expect(prefixPanelPaths(script)).toContain('fetch("/uygulama-paneli/api/apps")');
    expect(prefixPanelPaths(script)).toContain('"/uygulama-paneli/login.html"');
    expect(prefixPanelPaths(script)).toContain("`/uygulama-paneli/api/apps/");
  });

  it("leaves the public panel host untouched", () => {
    const text = '"https://mindcoach.fly-work.com/panel"';
    expect(prefixPanelPaths(text)).toBe(text);
  });

  it("prefixes redirects once", () => {
    expect(prefixPanelLocation("/panel")).toBe("/uygulama-paneli/panel");
    expect(prefixPanelLocation("/uygulama-paneli/panel")).toBe("/uygulama-paneli/panel");
    expect(prefixPanelLocation("https://apppanel.fly-work.com/panel")).toBe("https://apppanel.fly-work.com/panel");
  });
});
