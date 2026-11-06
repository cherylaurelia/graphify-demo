import { target } from "./target.js";

it("does the thing", async () => {
  register("/a", async (c) => { return target(c); });
});

declare function it(n: string, f: () => void): void;
declare function register(p: string, h: (c: number) => void): void;
