export function autoBodyServiceDescriptionV1(service: string): string {
  if (/\b(free\s+)?(repair\s+)?(quote|estimate)\b/i.test(service)) {
    return "An estimate request records the vehicle, damage area, timing, and preferred callback details.";
  }
  if (/frame/i.test(service)) {
    return "Frame straightening covers structural alignment concerns after an impact. The shop uses measurements and the vehicle's condition to outline the repair scope.";
  }
  if (/collision|body/i.test(service)) {
    return "Collision and body repair cover damaged panels and related impact areas. A shop inspection determines what can be repaired and what needs replacement.";
  }
  if (/hail/i.test(service)) {
    return "Hail damage repair covers dents across affected panels. The shop checks depth, location, and paint condition before recommending a repair approach.";
  }
  if (/\bpaint\b|refinish|color match/i.test(service)) {
    return "Paint and refinishing handle damaged finish on affected panels. The shop reviews the damage, panel condition, and surrounding color before estimating the work.";
  }
  if (/scratch|scuff/i.test(service)) {
    return "Scratch repair addresses visible scratches and scuffs in a panel's finish. Damage depth and location determine whether refinishing is needed.";
  }
  if (/glass|windshield|window/i.test(service)) {
    return "Auto glass service addresses damaged windows and other vehicle glass. Glass type and vehicle fit establish the replacement scope.";
  }
  if (/\bdents?\b|\bdings?\b|\bpdr\b|paintless dent/i.test(service)) {
    return "Paintless dent removal can fit smaller dents when the finish condition allows. Dent location, depth, and paint condition determine fit.";
  }
  if (/bumper|panel/i.test(service)) {
    return "Bumper and panel repair address visible impact damage in the affected area. Mounting damage and nearby panel condition shape the repair scope.";
  }
  return "The team evaluates the affected area and vehicle condition to confirm the appropriate repair work.";
}
