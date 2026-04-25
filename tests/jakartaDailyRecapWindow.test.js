import {
  getJakartaDailyRecapWindow,
  isWithinJakartaAttendanceWindow,
} from "../src/utils/jakartaTime.js";

describe("getJakartaDailyRecapWindow", () => {
  test("sets start at 00:01:00 WIB and end at execution time", () => {
    const referenceDate = new Date("2024-07-01T03:15:45.000Z"); // 10:15:45 WIB
    const window = getJakartaDailyRecapWindow(referenceDate);

    expect(window.startJakarta).toBe("2024-07-01 00:01:00");
    expect(window.endJakarta).toBe("2024-07-01 10:15:45");
    expect(window.startJakartaIso).toBe("2024-07-01T00:01:00+07:00");
    expect(window.endJakartaIso).toBe("2024-07-01T10:15:45+07:00");
  });

  test("boundary: post at 00:00:30 WIB excluded from daily recap", () => {
    const referenceDate = new Date("2024-06-30T20:00:00.000Z"); // 03:00:00 WIB
    const window = getJakartaDailyRecapWindow(referenceDate);
    const postDate = new Date("2024-06-30T17:00:30.000Z"); // 00:00:30 WIB

    expect(postDate < window.startUtcDate).toBe(true);
  });

  test("boundary: post at 00:01:00 WIB included in daily recap", () => {
    const referenceDate = new Date("2024-06-30T20:00:00.000Z"); // 03:00:00 WIB
    const window = getJakartaDailyRecapWindow(referenceDate);
    const postDate = new Date("2024-06-30T17:01:00.000Z"); // 00:01:00 WIB

    expect(postDate >= window.startUtcDate && postDate <= window.endUtcDate).toBe(true);
  });

  test("boundary: post after recap execution time excluded", () => {
    const referenceDate = new Date("2024-06-30T20:00:00.000Z"); // 03:00:00 WIB
    const window = getJakartaDailyRecapWindow(referenceDate);
    const postDate = new Date("2024-06-30T20:00:01.000Z"); // 03:00:01 WIB

    expect(postDate > window.endUtcDate).toBe(true);
  });

  test("attendance window remains independent from daily recap window", () => {
    const insideAttendanceWindow = isWithinJakartaAttendanceWindow(
      new Date("2024-06-30T18:00:00.000Z"),
      new Date("2024-07-01T03:00:00.000Z")
    );
    expect(insideAttendanceWindow).toBe(true);
  });
});
