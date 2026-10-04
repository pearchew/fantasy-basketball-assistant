import { describe, expect, it } from "vitest";
import { flipReportName, nameKey } from "../src/lib/names";

describe("nameKey", () => {
  it("matches across accents, punctuation and suffixes", () => {
    expect(nameKey("Luka Dončić")).toBe(nameKey("Luka Doncic"));
    expect(nameKey("Nikola Jokić")).toBe("nikola jokic");
    expect(nameKey("Dereck Lively II")).toBe("dereck lively");
    expect(nameKey("P.J. Washington")).toBe(nameKey("PJ Washington"));
    expect(nameKey("Jaren Jackson Jr.")).toBe("jaren jackson");
    expect(nameKey("De'Aaron Fox")).toBe("deaaron fox");
  });
});

describe("flipReportName", () => {
  it("turns 'Last, First' into 'First Last'", () => {
    expect(flipReportName("Irving, Kyrie")).toBe("Kyrie Irving");
    expect(flipReportName("Lively II, Dereck")).toBe("Dereck Lively II");
    expect(flipReportName("Nance Jr., Larry")).toBe("Larry Nance Jr.");
  });
});
