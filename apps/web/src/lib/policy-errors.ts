export interface PolicyDenyDetails {
  code: string;
  message: string;
  final_payable_minor?: number;
  max_spend_minor?: number;
  recoverable?: boolean;
  policy_decision_id?: string;
  policy_version?: string;
}

export class PolicyEvaluationDeniedError extends Error {
  readonly details: PolicyDenyDetails;

  constructor(details: PolicyDenyDetails) {
    super(details.message);
    this.name = "PolicyEvaluationDeniedError";
    this.details = details;
  }
}

export function isPolicyDeniedError(
  error: unknown,
): error is PolicyEvaluationDeniedError {
  return error instanceof PolicyEvaluationDeniedError;
}
