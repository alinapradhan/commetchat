import { describe, expect, it } from "vitest";
import { dayKey, formatDay, formatSize, splitLinks } from "./format";

const sec = (date) => Math.floor(date.getTime() / 1000);

describe("formatDay", () => {
  const now = new Date(2026, 9, 28, 15, 0);

  it("labels today and yesterday", () => {
    expect(formatDay(sec(new Date(2026, 9, 28, 9, 30)), now)).toBe("Today");
    expect(formatDay(sec(new Date(2026, 9, 27, 23, 59)), now)).toBe("Yesterday");
  });

  it("shows a date for older days and adds the year only when it differs", () => {
    expect(formatDay(sec(new Date(2026, 9, 20)), now)).not.toMatch(/2026/);
    expect(formatDay(sec(new Date(2025, 9, 20)), now)).toMatch(/2025/);
  });
});

describe("dayKey", () => {
  it("is equal for times on the same day and different across midnight", () => {
    expect(dayKey(sec(new Date(2026, 9, 28, 0, 1)))).toBe(dayKey(sec(new Date(2026, 9, 28, 23, 59))));
    expect(dayKey(sec(new Date(2026, 9, 28, 23, 59)))).not.toBe(dayKey(sec(new Date(2026, 9, 29, 0, 1))));
  });
});

describe("formatSize", () => {
  it("uses B, KB and MB", () => {
    expect(formatSize(0)).toBe("");
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(2048)).toBe("2 KB");
    expect(formatSize(3.5 * 1024 * 1024)).toBe("3.5 MB");
  });
});

describe("splitLinks", () => {
  it("returns plain text unchanged", () => {
    expect(splitLinks("hello there")).toEqual([{ type: "text", value: "hello there" }]);
  });

  it("finds links and leaves trailing punctuation out of them", () => {
    expect(splitLinks("Board: https://howl.in/board, see you.")).toEqual([
      { type: "text", value: "Board: " },
      { type: "link", value: "https://howl.in/board" },
      { type: "text", value: ", see you." },
    ]);
  });

  it("handles several links", () => {
    const parts = splitLinks("a http://x.io b https://y.io/p?q=1");
    expect(parts.filter((p) => p.type === "link").map((p) => p.value)).toEqual([
      "http://x.io",
      "https://y.io/p?q=1",
    ]);
  });
});
