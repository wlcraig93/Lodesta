import type { BusinessLocationRecord, BusinessProfile, BusinessRecord, SiteBundle, SiteLocationBinding } from "./models";

export function businessIdForProfile(profile: BusinessProfile) {
  const seed = profile.id || `${profile.name}_${profile.phone ?? ""}_${profile.address?.street ?? ""}`;
  return `biz_${stableHash(seed)}`;
}

export function businessRecordFromProfile(profile: BusinessProfile, businessId = businessIdForProfile(profile), now = new Date().toISOString()): BusinessRecord {
  return {
    id: businessId,
    name: profile.name,
    vertical: profile.vertical,
    profile,
    provenance: profile.provenance,
    createdAt: now,
    updatedAt: now
  };
}

export function businessLocationsFromProfile(
  profile: BusinessProfile,
  businessId = businessIdForProfile(profile),
  now = new Date().toISOString()
): BusinessLocationRecord[] {
  if (!profile.address && profile.serviceAreas.length === 0) return [];
  return [
    {
      id: locationIdForProfile(profile, businessId),
      businessId,
      label: profile.address?.city ?? profile.serviceAreas[0] ?? profile.name,
      address: profile.address,
      serviceAreas: profile.serviceAreas,
      phone: profile.phone,
      email: profile.email,
      hours: profile.hours,
      geo: profile.geo,
      provenance: profile.provenance,
      createdAt: now,
      updatedAt: now
    }
  ];
}

export function withBusinessBundleFields(bundle: SiteBundle, input: { businessId?: string; now?: string } = {}): SiteBundle {
  const businessId = input.businessId ?? businessIdForProfile(bundle.businessProfile);
  const now = input.now ?? new Date().toISOString();
  const business = businessRecordFromProfile(bundle.businessProfile, businessId, now);
  const locations = bundle.locations ?? businessLocationsFromProfile(bundle.businessProfile, businessId, now);
  const locationBindings = normalizeSiteLocationBindings(locations, bundle.locationBindings);
  return {
    ...bundle,
    business: bundle.business
      ? {
          ...business,
          workspaceId: bundle.business.workspaceId,
          createdAt: bundle.business.createdAt
        }
      : business,
    locations,
    locationBindings,
    renderProfile: bundle.businessProfile
  };
}

export function normalizeSiteLocationBindings(
  locations: BusinessLocationRecord[] = [],
  bindings: Array<Partial<SiteLocationBinding> & { locationId?: string; role?: unknown; orderIndex?: unknown }> | undefined
): SiteLocationBinding[] {
  if (!locations.length) return [];
  const locationOrder = new Map(locations.map((location, index) => [location.id, index]));
  const normalizedBindings = (bindings ?? [])
    .filter((binding) => typeof binding.locationId === "string" && locationOrder.has(binding.locationId))
    .map((binding, index) => ({
      locationId: binding.locationId as string,
      role: normalizeSiteLocationRole(binding.role),
      orderIndex: typeof binding.orderIndex === "number" && Number.isFinite(binding.orderIndex) ? binding.orderIndex : index
    }));

  const seen = new Set(normalizedBindings.map((binding) => binding.locationId));
  for (const location of locations) {
    if (seen.has(location.id)) continue;
    normalizedBindings.push({
      locationId: location.id,
      role: normalizedBindings.length === 0 ? "primary" : "covered",
      orderIndex: locationOrder.get(location.id) ?? normalizedBindings.length
    });
  }

  if (!normalizedBindings.some((binding) => binding.role === "primary") && normalizedBindings[0]) {
    normalizedBindings[0] = { ...normalizedBindings[0], role: "primary" };
  }

  return normalizedBindings.sort((left, right) => {
    const roleDelta = roleSortValue(left.role) - roleSortValue(right.role);
    if (roleDelta !== 0) return roleDelta;
    const orderDelta = left.orderIndex - right.orderIndex;
    if (orderDelta !== 0) return orderDelta;
    return left.locationId.localeCompare(right.locationId);
  }).map((binding, index) => ({ ...binding, orderIndex: index }));
}

export function normalizeSiteLocationRole(value: unknown): SiteLocationBinding["role"] {
  return value === "primary" ? "primary" : "covered";
}

function roleSortValue(role: SiteLocationBinding["role"]) {
  return role === "primary" ? 0 : 1;
}

function locationIdForProfile(profile: BusinessProfile, businessId: string) {
  return `loc_${stableHash(`${businessId}_${profile.address?.street ?? profile.serviceAreas.join("_")}`)}`;
}

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
