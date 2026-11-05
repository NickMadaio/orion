// w20 xf-other (tube audit M4): "open the german ebay in chrome" became a Google search ("I opened a search for German eBay"). A regional name is the site's own domain.
import { describe, expect, it } from "vitest";
import { openRequest } from "./open-request.js";

describe("a regional site name opens the regional domain", () => {
  it.each([
    ["open the german ebay in chrome", "https://www.ebay.de", "Google Chrome"],
    ["open ebay germany in safari", "https://www.ebay.de", "Safari"],
    ["pull up the french amazon", "https://www.amazon.fr", undefined],
    ["open amazon germany", "https://www.amazon.de", undefined],
    ["open the canadian amazon in chrome", "https://www.amazon.ca", "Google Chrome"],
    ["open the uk ebay pls", "https://www.ebay.co.uk", undefined],
    ["open the italian google", "https://www.google.it", undefined],
    ["open japanese amazon in safari", "https://www.amazon.co.jp", "Safari"],
    ["open ebay australia", "https://www.ebay.com.au", undefined],
  ])("%s", (m, url, browser) => expect(openRequest(m)).toEqual({ kind: "url", url, ...(browser ? { browser } : {}) }));
  it("still searches for a name it does not know, and leaves known sites alone", () => {
    expect(openRequest("open amazon uk")).toEqual({ kind: "url", url: "https://www.amazon.co.uk" });
    expect(openRequest("open the german ministry of health in chrome")).toMatchObject({ kind: "url", url: expect.stringContaining("google.com/search") });
    expect(openRequest("open ebay")).toEqual({ kind: "url", url: "https://www.ebay.com" });
  });
});
