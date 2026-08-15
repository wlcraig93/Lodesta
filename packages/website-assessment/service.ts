import type { WebsiteAssessmentRecord } from "@/packages/platform-operations";
import {
  websiteAssessmentRubricIdentity,
  websiteAssessmentScannerIdentity
} from "./rubric";
import { websiteHealthRouteSelectionIdentity } from "./route-selection";

export function websiteAssessmentRecordIsCurrent(record: WebsiteAssessmentRecord) {
  return record.rubricIdentity === websiteAssessmentRubricIdentity
    && record.scannerIdentity === websiteAssessmentScannerIdentity
    && (record.status !== "completed"
      || Boolean(record.assessment
        && record.assessment.schemaVersion === 2
        && record.assessment.producer.routeSelectionIdentity === websiteHealthRouteSelectionIdentity));
}
