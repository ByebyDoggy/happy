import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { publicLocalFilePath } from "./publicLocalFilePath";

describe("public local files", () => {
  it("does not bypass avatar authentication through the static files route", () => {
    expect(publicLocalFilePath("/data/files", "sessions/s1/avatar/a.enc")).toBeNull();
    expect(publicLocalFilePath("/data/files", "public/../sessions/s1/avatar/a.enc")).toBeNull();
    expect(publicLocalFilePath("/data/files", "../private")).toBeNull();
    // The function returns a platform-native absolute path (path.resolve), so the
    // expectation is built the same way instead of hardcoding a POSIX literal.
    expect(publicLocalFilePath("/data/files", "public/avatar.webp")).toBe(
      resolve("/data/files", "public/avatar.webp"),
    );
  });
});
