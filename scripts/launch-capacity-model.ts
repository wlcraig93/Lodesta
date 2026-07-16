import { readFileSync } from "node:fs";
import {
  defaultLaunchCapacityModelInput,
  runLaunchCapacityModel,
  type LaunchCapacityModelInput
} from "../lib/launch-capacity-model";

const aliasMap: Record<string, keyof LaunchCapacityModelInput> = {
  candidates: "candidatesGenerated",
  directions: "directionsPerCandidate",
  llmCost: "llmCostPerDirection",
  compileCost: "compileCostPerDirection",
  renderQaCost: "renderQaCostPerCandidate",
  operatorMinutes: "operatorMinutesPerCandidate",
  operatorHourlyCost: "operatorHourlyCost",
  operatorHoursPerDay: "operatorHoursPerDay",
  gateFailureRate: "gateFailureRate",
  failedClaimRate: "failedClaimRate",
  checkoutConversionRate: "checkoutConversionRate",
  refundChargebackRate: "refundChargebackRate",
  monthlyPrice: "monthlyPrice",
  grossMarginRate: "grossMarginRate",
  domainCost: "domainCostPerCustomerMonth",
  supportMinutes: "supportMinutesPerCustomerMonth",
  supportHourlyCost: "supportHourlyCost",
  monthlyChurnRate: "monthlyChurnRate",
  targetPaybackMonths: "targetPaybackMonths"
};

function main() {
  const { input, json } = parseArgs(process.argv.slice(2));
  const result = runLaunchCapacityModel(input);
  if (json) {
    console.log(JSON.stringify({ input, result }, null, 2));
    return;
  }
  console.log("Lodesta Phase 1.5 capacity model");
  console.log(`Candidate cost: $${result.candidateCost.toFixed(2)}`);
  console.log(`Total generation/review cost: $${result.totalGenerationCost.toFixed(2)}`);
  console.log(`Approved candidates: ${result.approvedCandidates}`);
  console.log(`Claimable candidates: ${result.claimableCandidates}`);
  console.log(`Expected paid customers: ${result.paidCustomers}`);
  console.log(`Cost per paid customer: ${result.costPerPaidCustomer === undefined ? "n/a" : `$${result.costPerPaidCustomer.toFixed(2)}`}`);
  console.log(`Monthly contribution/customer: $${result.monthlyContributionPerCustomer.toFixed(2)}`);
  console.log(`Expected payback: ${result.expectedPaybackMonths === undefined ? "n/a" : `${result.expectedPaybackMonths} months`}`);
  console.log(`Candidates/operator day: ${result.candidatesPerOperatorDay}`);
  console.log(`Paid customers/operator day: ${result.paidCustomersPerOperatorDay}`);
  console.log(
    `Minimum paid conversion for ${input.targetPaybackMonths}-month payback: ${
      result.minimumPaidConversionForTargetPayback === undefined
        ? "n/a"
        : `${(result.minimumPaidConversionForTargetPayback * 100).toFixed(1)}%`
    }`
  );
  console.log(`Decision: ${result.decision}`);
}

function parseArgs(args: string[]) {
  let input: LaunchCapacityModelInput = { ...defaultLaunchCapacityModelInput };
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--input") {
      const path = args[++index];
      if (!path) throw new Error("--input requires a JSON file path.");
      input = { ...input, ...parseInputFile(path) };
      continue;
    }
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    const field = aliasMap[key] ?? (key as keyof LaunchCapacityModelInput);
    if (!(field in input)) throw new Error(`Unknown capacity input: ${key}`);
    const rawValue = args[++index];
    if (rawValue === undefined) throw new Error(`--${key} requires a numeric value.`);
    const value = Number(rawValue);
    if (!Number.isFinite(value)) throw new Error(`--${key} must be numeric.`);
    input = { ...input, [field]: value };
  }
  return { input, json };
}

function parseInputFile(path: string): Partial<LaunchCapacityModelInput> {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const output: Partial<LaunchCapacityModelInput> = {};
  for (const [key, value] of Object.entries(parsed)) {
    const field = aliasMap[key] ?? (key as keyof LaunchCapacityModelInput);
    if (!(field in defaultLaunchCapacityModelInput)) throw new Error(`Unknown capacity input in ${path}: ${key}`);
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Capacity input ${key} must be numeric.`);
    output[field] = value;
  }
  return output;
}

main();
