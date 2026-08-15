export type GoogleAddressComponent = {
  longText?: string;
  shortText?: string;
  types?: string[];
};

export type ProspectAddressFields = {
  address_line_1?: string;
  address_line_2?: string;
  locality?: string;
  region?: string;
  postal_code?: string;
  country_code?: string;
  county?: string;
};

export function prospectAddressFromGoogleComponents(components?: GoogleAddressComponent[]): ProspectAddressFields {
  if (!components?.length) return {};
  const long = (type: string) => componentText(components, type, "longText");
  const short = (type: string) => componentText(components, type, "shortText") ?? long(type);
  const streetNumber = long("street_number");
  const route = long("route");
  const premise = long("premise");
  const postBox = long("post_box");
  const addressLine1 = joined([streetNumber, route]) ?? premise ?? postBox;
  const postalCode = joined([long("postal_code"), long("postal_code_suffix")], "-");
  return compact({
    address_line_1: addressLine1,
    address_line_2: long("subpremise"),
    locality: first([
      long("locality"),
      long("postal_town"),
      long("administrative_area_level_3"),
      long("sublocality_level_1")
    ]),
    region: short("administrative_area_level_1")?.toUpperCase(),
    postal_code: postalCode,
    country_code: short("country")?.toUpperCase(),
    county: long("administrative_area_level_2")
  });
}

function componentText(components: GoogleAddressComponent[], type: string, field: "longText" | "shortText") {
  const value = components.find((component) => component.types?.includes(type))?.[field];
  return value?.trim() || undefined;
}

function joined(values: Array<string | undefined>, separator = " ") {
  const present = values.filter((value): value is string => Boolean(value));
  return present.length ? present.join(separator) : undefined;
}

function first(values: Array<string | undefined>) {
  return values.find(Boolean);
}

function compact<T extends Record<string, string | undefined>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field)) as Partial<{ [K in keyof T]: string }>;
}
