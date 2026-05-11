import { describe, expect, it } from "vitest";

import { escapeHtmlAttr, renderUnitellerRedirectHtml } from "./orders";

describe("escapeHtmlAttr", () => {
  it("экранирует двойные кавычки, угловые скобки и амперсанд", () => {
    expect(escapeHtmlAttr(`"<>&`)).toBe("&quot;&lt;&gt;&amp;");
  });

  it("порядок: сначала & затем остальное (не даёт двойного escape)", () => {
    expect(escapeHtmlAttr("&quot;")).toBe("&amp;quot;");
  });

  it("обычный текст пропускает как есть", () => {
    expect(escapeHtmlAttr("BGX-20260424-0042")).toBe("BGX-20260424-0042");
  });

  it("unicode не трогает", () => {
    expect(escapeHtmlAttr("Привет 👋")).toBe("Привет 👋");
  });
});

describe("renderUnitellerRedirectHtml", () => {
  const action = "https://wpay.uniteller.ru/pay/";
  const minimalFields = {
    Shop_IDP: "POINT0001",
    Order_IDP: "BGX-20260424-0001",
    Subtotal_P: "15000.00",
    Signature: "A".repeat(32),
  };

  it("возвращает полный HTML с doctype и auto-submit скриптом", () => {
    const html = renderUnitellerRedirectHtml(action, minimalFields);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('<form id="uniteller-redirect"');
    expect(html).toContain(`action="${action}"`);
    expect(html).toContain('method="POST"');
    expect(html).toContain('accept-charset="utf-8"');
    expect(html).toContain("document.getElementById('uniteller-redirect').submit()");
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
  });

  it("все поля выводит как hidden inputs с экранированными value", () => {
    const html = renderUnitellerRedirectHtml(action, minimalFields);
    for (const [name, value] of Object.entries(minimalFields)) {
      expect(html).toContain(`name="${name}"`);
      expect(html).toContain(`value="${value}"`);
    }
  });

  it("экранирует XSS в значениях", () => {
    const html = renderUnitellerRedirectHtml(action, {
      Order_IDP: `BGX-"><script>alert(1)</script>`,
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("экранирует & в action URL (query string safety)", () => {
    const html = renderUnitellerRedirectHtml("https://host?a=1&b=2", {
      Order_IDP: "BGX-20260424-0001",
    });
    expect(html).toContain(`action="https://host?a=1&amp;b=2"`);
  });

  it("number-значения приводит к строкам", () => {
    const html = renderUnitellerRedirectHtml(action, { Lifetime: 30 });
    expect(html).toContain(`name="Lifetime"`);
    expect(html).toContain(`value="30"`);
  });

  it("<noscript>-fallback содержит ручную кнопку", () => {
    const html = renderUnitellerRedirectHtml(action, minimalFields);
    expect(html).toMatch(/<noscript>[\s\S]*<button type="submit">/);
  });
});
