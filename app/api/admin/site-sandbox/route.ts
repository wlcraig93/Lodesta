import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/security";
import { sitePlatformRepository } from "@/packages/platform-data";

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const control = await sitePlatformRepository.getSandboxControl();
  if (!control) return NextResponse.json({ configured: false });
  const deploymentIds = [...new Set([
    control.blueDeploymentId,
    control.greenDeploymentId
  ].filter((value): value is string => Boolean(value)))];
  const deployments = await Promise.all(deploymentIds.map(async (deploymentId) => {
    const [deployment, drain] = await Promise.all([
      sitePlatformRepository.getSandboxDeployment(deploymentId),
      sitePlatformRepository.getSandboxDeploymentDrain(deploymentId)
    ]);
    return {
      deployment,
      lifecycle: control.activeDeploymentId === deploymentId
        ? "active"
        : drain.runningRunIds.length || drain.liveSessionIds.length
          ? "draining"
          : "standby",
      drain
    };
  }));
  return NextResponse.json({ configured: true, control, deployments });
}
