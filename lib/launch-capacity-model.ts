export type LaunchCapacityModelInput = {
  candidatesGenerated: number;
  directionsPerCandidate: number;
  llmCostPerDirection: number;
  compileCostPerDirection: number;
  renderQaCostPerCandidate: number;
  operatorMinutesPerCandidate: number;
  operatorHourlyCost: number;
  operatorHoursPerDay: number;
  gateFailureRate: number;
  failedClaimRate: number;
  checkoutConversionRate: number;
  refundChargebackRate: number;
  monthlyPrice: number;
  grossMarginRate: number;
  domainCostPerCustomerMonth: number;
  supportMinutesPerCustomerMonth: number;
  supportHourlyCost: number;
  monthlyChurnRate: number;
  targetPaybackMonths: number;
};

export type LaunchCapacityModelResult = {
  candidateCost: number;
  totalGenerationCost: number;
  approvedCandidates: number;
  claimableCandidates: number;
  paidCustomers: number;
  costPerPaidCustomer?: number;
  monthlyContributionPerCustomer: number;
  expectedPaybackMonths?: number;
  expectedLifetimeMonths?: number;
  expectedGrossProfitPerCustomer?: number;
  candidatesPerOperatorDay: number;
  paidCustomersPerOperatorDay: number;
  minimumPaidConversionForTargetPayback?: number;
  decision: "scale_candidate" | "hold_or_fix_unit_economics" | "insufficient_paid_volume";
};

export const defaultLaunchCapacityModelInput: LaunchCapacityModelInput = {
  candidatesGenerated: 20,
  directionsPerCandidate: 1,
  llmCostPerDirection: 5,
  compileCostPerDirection: 0.5,
  renderQaCostPerCandidate: 1,
  operatorMinutesPerCandidate: 12,
  operatorHourlyCost: 50,
  operatorHoursPerDay: 4,
  gateFailureRate: 0.2,
  failedClaimRate: 0.1,
  checkoutConversionRate: 0.08,
  refundChargebackRate: 0.05,
  monthlyPrice: 149,
  grossMarginRate: 0.85,
  domainCostPerCustomerMonth: 1.25,
  supportMinutesPerCustomerMonth: 20,
  supportHourlyCost: 50,
  monthlyChurnRate: 0.05,
  targetPaybackMonths: 3
};

export function runLaunchCapacityModel(input: LaunchCapacityModelInput): LaunchCapacityModelResult {
  const candidateCost =
    input.directionsPerCandidate * (input.llmCostPerDirection + input.compileCostPerDirection) +
    input.renderQaCostPerCandidate +
    (input.operatorMinutesPerCandidate / 60) * input.operatorHourlyCost;
  const totalGenerationCost = candidateCost * input.candidatesGenerated;
  const approvedCandidates = input.candidatesGenerated * (1 - input.gateFailureRate);
  const claimableCandidates = approvedCandidates * (1 - input.failedClaimRate);
  const paidCustomers = claimableCandidates * input.checkoutConversionRate * (1 - input.refundChargebackRate);
  const costPerPaidCustomer = paidCustomers > 0 ? totalGenerationCost / paidCustomers : undefined;
  const monthlySupportCost = (input.supportMinutesPerCustomerMonth / 60) * input.supportHourlyCost;
  const monthlyContributionPerCustomer =
    input.monthlyPrice * input.grossMarginRate - input.domainCostPerCustomerMonth - monthlySupportCost;
  const expectedPaybackMonths =
    costPerPaidCustomer !== undefined && monthlyContributionPerCustomer > 0
      ? costPerPaidCustomer / monthlyContributionPerCustomer
      : undefined;
  const expectedLifetimeMonths = input.monthlyChurnRate > 0 ? 1 / input.monthlyChurnRate : undefined;
  const expectedGrossProfitPerCustomer =
    expectedLifetimeMonths !== undefined && costPerPaidCustomer !== undefined
      ? monthlyContributionPerCustomer * expectedLifetimeMonths - costPerPaidCustomer
      : undefined;
  const candidatesPerOperatorDay =
    input.operatorMinutesPerCandidate > 0 ? (input.operatorHoursPerDay * 60) / input.operatorMinutesPerCandidate : 0;
  const paidCustomersPerOperatorDay =
    candidatesPerOperatorDay * (1 - input.gateFailureRate) * (1 - input.failedClaimRate) * input.checkoutConversionRate * (1 - input.refundChargebackRate);
  const maximumCostPerPaidAtTarget = monthlyContributionPerCustomer * input.targetPaybackMonths;
  const minimumPaidConversionForTargetPayback =
    maximumCostPerPaidAtTarget > 0
      ? Math.min(
          1,
          candidateCost /
            Math.max(0.000001, maximumCostPerPaidAtTarget * (1 - input.gateFailureRate) * (1 - input.failedClaimRate) * (1 - input.refundChargebackRate))
        )
      : undefined;
  const decision =
    !paidCustomers
      ? "insufficient_paid_volume"
      : expectedPaybackMonths !== undefined && expectedPaybackMonths <= input.targetPaybackMonths
        ? "scale_candidate"
        : "hold_or_fix_unit_economics";

  return {
    candidateCost: roundCurrency(candidateCost),
    totalGenerationCost: roundCurrency(totalGenerationCost),
    approvedCandidates: roundCount(approvedCandidates),
    claimableCandidates: roundCount(claimableCandidates),
    paidCustomers: roundCount(paidCustomers),
    costPerPaidCustomer: costPerPaidCustomer === undefined ? undefined : roundCurrency(costPerPaidCustomer),
    monthlyContributionPerCustomer: roundCurrency(monthlyContributionPerCustomer),
    expectedPaybackMonths: expectedPaybackMonths === undefined ? undefined : roundMetric(expectedPaybackMonths),
    expectedLifetimeMonths: expectedLifetimeMonths === undefined ? undefined : roundMetric(expectedLifetimeMonths),
    expectedGrossProfitPerCustomer: expectedGrossProfitPerCustomer === undefined ? undefined : roundCurrency(expectedGrossProfitPerCustomer),
    candidatesPerOperatorDay: roundMetric(candidatesPerOperatorDay),
    paidCustomersPerOperatorDay: roundMetric(paidCustomersPerOperatorDay),
    minimumPaidConversionForTargetPayback:
      minimumPaidConversionForTargetPayback === undefined ? undefined : roundMetric(minimumPaidConversionForTargetPayback),
    decision
  };
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function roundCount(value: number) {
  return Math.round(value * 100) / 100;
}

function roundMetric(value: number) {
  return Math.round(value * 1000) / 1000;
}
