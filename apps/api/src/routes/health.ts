import type { Request, Response } from "express";
import type { ApiSuccessResponse, HealthData } from "@mandate/types";

export function healthHandler(req: Request, res: Response): void {
  const body: ApiSuccessResponse<HealthData> = {
    data: { status: "ok" },
    meta: { request_id: req.requestId },
  };
  res.status(200).json(body);
}
