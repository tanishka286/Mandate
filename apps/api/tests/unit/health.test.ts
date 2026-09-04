import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";

describe("GET /api/v1/health", () => {
  const app = createApp();

  beforeAll(() => {
    process.env.NODE_ENV = "test";
  });

  it("returns ok with request_id in meta", async () => {
    const res = await request(app).get("/api/v1/health");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      data: { status: "ok" },
      meta: { request_id: expect.any(String) },
    });
    expect(res.headers["x-request-id"]).toBe(res.body.meta.request_id);
  });

  it("honors inbound X-Request-ID", async () => {
    const res = await request(app)
      .get("/api/v1/health")
      .set("X-Request-ID", "req-test-001");

    expect(res.status).toBe(200);
    expect(res.body.meta.request_id).toBe("req-test-001");
    expect(res.headers["x-request-id"]).toBe("req-test-001");
  });
});
