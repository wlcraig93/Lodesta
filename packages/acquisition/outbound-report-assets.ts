import QRCode from "qrcode";

export function outboundReportUrl(origin: string, reportId: string) {
  return `${new URL(origin).origin}/website-health-report/${encodeURIComponent(reportId)}`;
}

export async function outboundReportQrSvg(reportUrl: string) {
  return QRCode.toString(reportUrl, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
    color: {
      dark: "#17362b",
      light: "#fffdf7"
    }
  });
}
