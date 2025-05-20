import { assertEquals } from "https://deno.land/std/testing/asserts.ts";

Deno.test("GET / endpoint", async () => {
  const response = await fetch(
    "http://localhost:" + Deno.env.get("API_PORT") + "/",
  );
  const text = await response.text();
  assertEquals(text, "Hi Mom");
});
